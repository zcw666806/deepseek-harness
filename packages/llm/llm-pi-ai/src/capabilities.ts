/** Model-directory capability and portable settings without host authentication data. */
import { isIP } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { isCredentialKeySegment } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { CapabilityId, CapabilityProvider, CapabilityRequirement } from '@deepseek-ai/dsh-capability-manager/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { recordKeyFor } from './auth.ts'
import { Config as ConfigSchema, resolveProfiles } from './config.ts'
import type { Options, PiAiProviderProfile, ResolvedPiAiProviderProfile } from './config.ts'

const fields: readonly (keyof PiAiProviderProfile)[] = [
  'apiKeyEnv', 'displayName', 'api', 'models', 'modelOverrides', 'compat', 'defaultContextWindow', 'defaultMaxTokens',
  'defaultInput', 'reasoning', 'thinkingBudgets', 'cacheRetention', 'transport', 'timeoutMs', 'websocketConnectTimeoutMs',
  'streamIdleTimeoutMs', 'videoPollIntervalMs', 'videoTimeoutMs', 'maxRequestImageBytes', 'requestImagePixelBudget',
  'maxRequestImages', 'imageOffloadCountQuantum', 'requestImageBudgetCount', 'requestImageMaxDimension',
  'requestImageMaxBytes', 'retryPolicy',
]

function publicEndpoint(value: string): boolean {
  let url: URL
  try { url = new URL(value) } catch { return false }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && host.includes('.') && !isIP(host.replace(/^\[|\]$/g, ''))
    && !['.localhost', '.local', '.internal', '.lan'].some(suffix => host.endsWith(suffix))
}

function object(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Model settings must contain JSON objects.')
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => ['__proto__', 'prototype', 'constructor'].includes(key)
    || (allowed !== undefined && !allowed.includes(key)))) throw new Error('Model settings contain an unsupported field.')
  return record
}

function safeValues(value: unknown, key = ''): void {
  if (typeof value === 'string') {
    if (value && /^(?:api.?key|authorization|password|secret|credential|access.?token|token)$/i.test(key)) {
      throw new Error('Model credentials must be bound on the target machine.')
    }
    if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/|[a-zA-Z][a-zA-Z\d+.-]*:\/\/)/.test(value)) {
      throw new Error('Nested model paths and URLs require a machine-local binding.')
    }
  } else if (Array.isArray(value)) {
    for (const item of value) safeValues(item, key)
  } else if (typeof value === 'object' && value !== null) {
    for (const [name, item] of Object.entries(object(value))) safeValues(item, name)
  }
}

/**
 * Export declared model routes, excluding headers and machine-specific endpoint bindings.
 * @param config - Current settings source, before provider-runtime objects are constructed.
 * @returns Versioned declaration with credential reference names but no resolved credentials or host paths.
 */
export function exportModelConfiguration(config: Options): JsonValue {
  resolveProfiles(config.providers)
  object(config.providers ?? {})
  const providers = Object.fromEntries(Object.entries(config.providers ?? {}).map(([name, profile]) => {
    const selected = Object.fromEntries(fields.flatMap(key => profile[key] === undefined ? [] : [[key, profile[key]]]))
    safeValues(selected)
    const endpoint = profile.baseURL !== undefined && !publicEndpoint(profile.baseURL)
    const portable = profile.baseURL !== undefined && !endpoint ? { ...selected, baseURL: profile.baseURL } : selected
    return [name, { profile: portable, bindings: { endpoint, headers: Object.keys(profile.headers ?? {}).length > 0 } }]
  }))
  return JSON.parse(JSON.stringify({ version: 1, providers })) as JsonValue
}

/**
 * Rebind portable model definitions over this machine's existing endpoint, header and credential-reference choices.
 * @param value - Untrusted portable capability configuration.
 * @param machine - Current model settings whose machine-bound fields take precedence.
 * @returns Complete validated providers to merge atomically into the existing settings namespace.
 */
export function restoreModelConfiguration(value: JsonValue, machine: Options): Options {
  const root = object(value, ['version', 'providers'])
  if (root['version'] !== 1) throw new Error('Unsupported portable model configuration version.')
  const providers = Object.entries(object(root['providers'])).map(([name, raw]): [string, PiAiProviderProfile] => {
    const entry = object(raw, ['profile', 'bindings'])
    const profile = object(entry['profile'], [...fields, 'baseURL'])
    const bindings = object(entry['bindings'], ['endpoint', 'headers'])
    if (typeof bindings['endpoint'] !== 'boolean' || typeof bindings['headers'] !== 'boolean') throw new Error('Model binding requirements must be booleans.')
    const { baseURL, ...portable } = profile
    safeValues(portable)
    if (baseURL !== undefined && (typeof baseURL !== 'string' || !publicEndpoint(baseURL))) throw new Error('Portable model endpoints must be public HTTPS names without credentials or query parameters.')
    const local = machine.providers?.[name]
    const endpoint = local?.baseURL ?? baseURL
    const headers = local?.headers
    if (bindings['endpoint'] && local?.baseURL === undefined) throw new Error('Restore requires this machine\'s model endpoint binding.')
    if (bindings['headers'] && Object.keys(headers ?? {}).length === 0) throw new Error('Restore requires this machine\'s provider header bindings.')
    const candidate = { ...portable, ...endpoint === undefined ? {} : { baseURL: endpoint },
      ...headers === undefined ? {} : { headers },
      ...local?.apiKeyEnv === undefined ? {} : { apiKeyEnv: local.apiKeyEnv } }
    return [name, candidate]
  })
  const candidate = ConfigSchema({ providers: { ...machine.providers, ...Object.fromEntries(providers) } })
  const resolved = structuredClone(candidate.providers.get()) as NonNullable<Options['providers']>
  resolveProfiles(resolved)
  return { providers: resolved }
}

async function configuredCredential(ctx: Context, provider: string, profile: ResolvedPiAiProviderProfile): Promise<boolean> {
  const credentials = ctx.get('credentials')
  if (profile.apiKeyEnv !== undefined) {
    if (credentials !== undefined) return (await credentials.describe(profile.apiKeyEnv)).configured
    return Boolean(launchEnvironmentOf(ctx).get(profile.apiKeyEnv)?.value)
  }
  return credentials !== undefined && isCredentialKeySegment(provider)
    && (await credentials.describeRecord(recordKeyFor(provider))).configured
}

/**
 * Contribute model definitions and portable settings without sending a model request or refreshing OAuth.
 * @param ctx - Scoped context with the capability registry present.
 * @param settingsNs - Loader-assigned namespace for this adapter instance.
 * @param current - Current declared settings source.
 * @param profiles - Current resolved model directory.
 * @returns Asynchronous registry disposer.
 */
export function registerModelCapability(
  ctx: Context,
  settingsNs: string,
  current: () => Options,
  profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>,
): () => Promise<void> {
  const provider: CapabilityProvider = {
    descriptor: { id: brandString<CapabilityId>('models.pi-ai'), title: 'pi-ai model providers',
      description: 'pi-ai family configuration and local credential bindings; remote inference is not tested.',
      category: 'models', engineId: 'pi-ai', version: '1', kind: 'remote' },
    async inspect(signal) {
      const requirements: CapabilityRequirement[] = []
      for (const [name, profile] of profiles()) {
        signal.throwIfAborted()
        const count = profile.piProvider?.getModels().length ?? 0
        requirements.push({ id: `models:${name}`, title: profile.displayName, status: count > 0 ? 'available' : 'missing',
          message: `${count} configured models.` })
        const configured = await configuredCredential(ctx, name, profile)
        signal.throwIfAborted()
        requirements.push({ id: `credential:${name}`, title: `${profile.displayName} authorization`,
          status: configured ? 'available' : 'missing',
          ...configured ? {} : { message: 'Bind authorization in Models settings; ambient provider authentication is not probed.' } })
      }
      return { status: requirements.length === 0 || requirements.some(item => item.status === 'missing') ? 'missing' : 'ready',
        requirements, message: 'Configuration and local authorization metadata only; no model request or OAuth refresh was made.' }
    },
    exportConfiguration(signal) { signal.throwIfAborted(); return Promise.resolve(exportModelConfiguration(current())) },
    async restoreConfiguration(configuration, signal) {
      signal.throwIfAborted()
      const settings = ctx.get('settings')
      if (settings === undefined) throw new Error('Persistent model settings are unavailable.')
      const descriptor = settings.describe().find(item => item.ns === settingsNs)
      if (descriptor === undefined) throw new Error('The model settings namespace is unavailable.')
      const candidate = restoreModelConfiguration(configuration, current())
      signal.throwIfAborted()
      await settings.update(settingsNs, candidate, descriptor.revision)
    },
  }
  return ctx.capabilities.register(provider)
}
