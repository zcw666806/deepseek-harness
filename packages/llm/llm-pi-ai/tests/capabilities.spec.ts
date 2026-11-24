import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import CapabilityManager from '@deepseek-ai/dsh-capability-manager'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CapabilityId } from '@deepseek-ai/dsh-capability-manager/types'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as PiAi from '../src/index.ts'
import type { Options } from '../src/config.ts'
import { exportModelConfiguration, restoreModelConfiguration } from '../src/capabilities.ts'

function configuration(baseURL = 'https://models.example/v1'): Options {
  return { providers: { gateway: {
    api: 'openai-completions', baseURL, apiKeyEnv: 'MODEL_KEY',
    models: [{ id: 'chat', output: ['text'], contextWindow: 8192, maxTokens: 512 }],
  } } }
}

const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  vi.unstubAllGlobals()
})

describe('portable pi-ai model settings', () => {
  it('omits source header values and keeps only credential reference names', () => {
    const source = configuration()
    source.providers!.gateway!.headers = { Authorization: 'Bearer source-secret', 'X-Tenant': 'source-tenant' }
    const exported = exportModelConfiguration(source)
    expect(JSON.stringify(exported)).not.toContain('source-secret')
    expect(JSON.stringify(exported)).not.toContain('source-tenant')
    expect(exported).toMatchObject({ version: 1, providers: { gateway: {
      profile: { apiKeyEnv: 'MODEL_KEY', baseURL: 'https://models.example/v1' }, bindings: { endpoint: false, headers: true },
    } } })
  })

  it.each(['http://127.0.0.1:8080/v1', 'https://192.168.1.10/v1', 'https://service.local/v1', 'https://localhost./v1',
    'https://user:password@models.example/v1', 'https://models.example/v1?key=secret'])('leaves endpoint %s on its source machine', (endpoint) => {
    const exported = exportModelConfiguration(configuration(endpoint))
    expect(JSON.stringify(exported)).not.toContain(endpoint)
    expect(exported).toMatchObject({ providers: { gateway: { bindings: { endpoint: true } } } })
    expect(() => restoreModelConfiguration(exported, { providers: {} })).toThrow('endpoint binding')
  })

  it('preserves target endpoint, header and credential-reference bindings while restoring model definitions', () => {
    const source = configuration()
    source.providers!.gateway!.headers = { Authorization: 'Bearer source-secret' }
    const local = configuration('http://127.0.0.1:9999/v1')
    local.providers!.gateway!.apiKeyEnv = 'LOCAL_MODEL_KEY'
    local.providers!.gateway!.headers = { Authorization: 'Bearer local-secret' }
    const restored = restoreModelConfiguration(exportModelConfiguration(source), local)
    expect(restored.providers?.gateway).toMatchObject({
      baseURL: 'http://127.0.0.1:9999/v1', apiKeyEnv: 'LOCAL_MODEL_KEY',
      headers: { Authorization: 'Bearer local-secret' }, models: [{ id: 'chat' }],
    })
    expect(JSON.stringify(restored)).not.toContain('source-secret')
  })

  it('refuses missing required target headers and unsupported imported fields before returning settings', () => {
    const source = configuration()
    source.providers!.gateway!.headers = { Authorization: 'source-secret' }
    expect(() => restoreModelConfiguration(exportModelConfiguration(source), configuration())).toThrow('header bindings')
    expect(() => restoreModelConfiguration({ version: 1, providers: { gateway: {
      profile: { command: 'execute' }, bindings: { endpoint: false, headers: false },
    } } }, configuration())).toThrow('unsupported field')
    expect(() => restoreModelConfiguration({ version: 1, providers: { gateway: {
      profile: { api: 'unavailable-protocol', baseURL: 'https://models.example/v1', models: [{ id: 'other' }] },
      bindings: { endpoint: false, headers: false },
    } } }, configuration())).toThrow()
  })

  it('rejects nested credentials and model paths instead of silently exporting them', () => {
    const source = configuration()
    source.providers!.gateway!.compat = { chatTemplateKwargs: { secret: 'private' } }
    expect(() => exportModelConfiguration(source)).toThrow('credentials')
    source.providers!.gateway!.compat = { chatTemplateKwargs: { model_path: 'C:/models/local' } }
    expect(() => exportModelConfiguration(source)).toThrow('paths and URLs')
  })
})

describe('model capability through a real Loader composition', () => {
  it('reports credential binding, restores definitions atomically, and unregisters without a model request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pi-capabilities-'))
    const ctx = new Context()
    disposers.push(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
    const modules = new Map<string, unknown>([
      ['llm', LlmRuntime], ['manager', CapabilityManager], ['credentials', Credentials], ['pi-ai', PiAi],
    ])
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, JSON.stringify([
      { name: 'llm' }, { name: 'manager' },
      { name: 'credentials', config: { path: join(root, '.credentials.yml'), debounceMs: 10 } },
      { id: 'pi-ai', name: 'pi-ai', config: configuration() },
    ]))
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = {
      version: 'v2', loadCache: new Map(), async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`Unexpected Loader fixture import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    const settingsPath = await profileComposition(ctx, root, configPath)
    expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    const fetch = vi.fn(() => Promise.reject(new Error('No network requests allowed')))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    const id = brandString<CapabilityId>('models.pi-ai')
    expect((await ctx.capabilities.list(signal)).find(item => item.id === id)?.status).toBe('missing')
    await ctx.credentials.set(credentialRef('MODEL_KEY'), 'local-secret')
    expect((await ctx.capabilities.perform(id, 'check', signal)).status).toBe('ready')
    const exported = await ctx.capabilities.exportManifest(signal)
    expect(JSON.stringify(exported)).not.toContain('local-secret')
    const portable = exported.capabilities.find(item => item.id === id)
    if (portable?.configuration === undefined) throw new Error('Model capability was not exported.')
    const incoming = structuredClone(portable.configuration) as {
      version: number
      providers: { gateway: { profile: { models: { id: string }[] } } }
    }
    incoming.providers.gateway.profile.models[0]!.id = 'restored-chat'
    const result = await ctx.capabilities.restoreManifest({
      ...exported, capabilities: [{ ...portable, configuration: incoming }],
    }, signal)
    expect(result).toEqual([{ id, status: 'restored' }])
    expect(ctx.settings.describe().find(section => section.ns === 'pi-ai')?.value).toMatchObject({ providers: { gateway: { models: [{ id: 'restored-chat' }] } } })
    const before = await readFile(settingsPath, 'utf8')
    incoming.providers.gateway.profile.models[0]!.id = ''
    expect(await ctx.capabilities.restoreManifest({
      ...exported, capabilities: [{ ...portable, configuration: incoming }],
    }, signal)).toEqual([
      { id, status: 'failed', message: 'The capability rejected its imported settings.' },
    ])
    expect(await readFile(settingsPath, 'utf8')).toBe(before)
    expect(fetch).not.toHaveBeenCalled()
    const entry = [...ctx.loader.entries()].find(item => item.options.id === 'pi-ai')
    await entry?.fiber?.dispose()
    expect(await ctx.capabilities.list(signal)).toEqual([])
  })
})
