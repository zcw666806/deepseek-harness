/** Validate operator templates without evaluating or executing workflow nodes. */
import { createHash } from 'node:crypto'
import s from '@deepseek-ai/schemastery'
import { z } from 'zod'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { Config as ConfigInput, ComfyWorkflow, ScalarBinding } from './types.ts'

/** Operator-supplied configuration before defaults and template validation. */
export type Config = ConfigInput

const scalar = s.object({ node: s.string().required(), input: s.string().required() })

/** Loader configuration; runtime template validation occurs before registration. */
export const Config = s.object({
  enabled: s.boolean().default(false).volatile(),
  managedCapability: s.string(),
  baseURL: s.string().volatile(),
  headers: s.dict(s.string()).role('secret').default({}),
  workflows: s.array(s.object({
    id: s.string().required(), title: s.string().required(), template: s.dict(s.any()).required(),
    prompt: scalar.required(),
    duration: s.object({ node: s.string().required(), input: s.string().required(), unit: s.union(['seconds', 'frames']).required(), fps: s.number(), frameOffset: s.number() }).required(),
    width: scalar.required(), height: scalar.required(), references: s.array(scalar).required(), outputPrefix: scalar.required(),
    durations: s.array(s.number()).required(),
    sizes: s.array(s.object({
      aspectRatio: s.union(['16:9', '9:16', '1:1']).required(), resolution: s.union(['480p', '720p']).required(),
      width: s.number().required(), height: s.number().required(),
    })).required(),
    output: s.object({ node: s.string().required(), key: s.string().required(), index: s.number().required() }).required(),
  })).default([]).volatile(),
  timeoutMs: s.number().step(1).min(1).max(2_147_483_647).default(300_000),
  cleanupTimeoutMs: s.number().step(1).min(1).max(2_147_483_647).default(10_000),
  pollIntervalMs: s.number().step(1).min(1).max(2_147_483_647).default(1_000),
  maxJsonBytes: s.number().step(1).min(1).max(16_777_216).default(1_048_576),
  maxUploadBytes: s.number().step(1).min(1).max(2_147_483_647).default(20_971_520),
  maxVideoBytes: s.number().step(1).min(1).max(2_147_483_647).default(536_870_912),
})

/** Loader-owned live fields alongside fixed host transport settings. */
export type LiveConfig = ReturnType<typeof Config>
type ReadConfig = Required<Omit<ConfigInput, 'baseURL' | 'managedCapability'>> & Pick<ConfigInput, 'baseURL' | 'managedCapability'>

/** Read the current operator settings from a resolved Loader config.
 * @param config Live Loader values.
 * @returns The complete configuration for provider operations.
 */
export function readConfig(config: LiveConfig): ReadConfig {
  const { baseURL, enabled, workflows, managedCapability, ...transport } = config
  const endpoint = baseURL.get()
  return {
    ...transport, enabled: enabled.get(), workflows: workflows.get() as readonly ComfyWorkflow[],
    ...endpoint === undefined ? {} : { baseURL: endpoint },
    ...managedCapability === undefined ? {} : { managedCapability },
  }
}

const safeKey = z.string().min(1).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value), 'reserved property')
const binding = z.object({ node: safeKey, input: safeKey }).strict()
const workflowSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/), title: z.string().trim().min(1),
  template: z.record(safeKey, z.json()), prompt: binding,
  duration: binding.extend({ unit: z.enum(['seconds', 'frames']), fps: z.number().positive().optional(), frameOffset: z.number().int().optional() }),
  width: binding, height: binding, references: z.array(binding), outputPrefix: binding,
  durations: z.array(z.number().int().positive().max(15)).min(1),
  sizes: z.array(z.object({
    aspectRatio: z.enum(['16:9', '9:16', '1:1']), resolution: z.enum(['480p', '720p']),
    width: z.number().int().positive().max(16384), height: z.number().int().positive().max(16384),
  }).strict()).min(1),
  output: z.object({ node: safeKey, key: safeKey, index: z.number().int().nonnegative() }).strict(),
}).strict()

/** Validated workflow with a revision over its complete operator configuration. */
export interface ResolvedWorkflow extends ComfyWorkflow {
  readonly revision: string
  readonly template: Readonly<Record<string, { readonly class_type: string; readonly inputs: Readonly<Record<string, JsonValue>> }>>
}

/** Fully validated transport and workflows; disabled configurations have no endpoint. */
export interface ResolvedConfig extends Required<Omit<Config, 'baseURL' | 'workflows' | 'managedCapability'>> {
  readonly baseURL: URL | undefined
  readonly workflows: readonly ResolvedWorkflow[]
  readonly managedCapability?: string
}

function jsonValue(value: unknown): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return
  if (Array.isArray(value)) { for (const item of value) jsonValue(item); return }
  if (typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error('Workflow values must be finite JSON values.')
  for (const [key, item] of Object.entries(value)) { safeKey.parse(key); jsonValue(item) }
}

function scalarInput(workflow: ResolvedWorkflow['template'], target: ScalarBinding, kind: 'string' | 'number'): void {
  const node = workflow[target.node]
  if (!node || !Object.hasOwn(node.inputs, target.input) || typeof node.inputs[target.input] !== kind) {
    throw new Error(`Workflow binding ${target.node}.${target.input} must name an existing ${kind} scalar input.`)
  }
}

function resolveWorkflow(input: ComfyWorkflow, maxBytes: number): ResolvedWorkflow {
  const parsed = workflowSchema.parse(input)
  jsonValue(parsed.template)
  if (Buffer.byteLength(JSON.stringify(parsed)) > maxBytes) throw new Error('Workflow configuration exceeds maxJsonBytes.')
  const template = z.record(safeKey, z.object({
    class_type: z.string().min(1), inputs: z.record(safeKey, z.json()), _meta: z.json().optional(),
  }).strict()).parse(parsed.template)
  if (Object.keys(template).length === 0) throw new Error('Workflow template must contain API-format nodes.')
  scalarInput(template, parsed.prompt, 'string')
  scalarInput(template, parsed.duration, 'number')
  scalarInput(template, parsed.width, 'number')
  scalarInput(template, parsed.height, 'number')
  for (const target of parsed.references) scalarInput(template, target, 'string')
  scalarInput(template, parsed.outputPrefix, 'string')
  if (!Object.hasOwn(template, parsed.output.node)) throw new Error('Workflow output must name an existing API node.')
  const targets = [parsed.prompt, parsed.duration, parsed.width, parsed.height, ...parsed.references, parsed.outputPrefix]
  if (new Set(targets.map(target => JSON.stringify([target.node, target.input]))).size !== targets.length) throw new Error('Workflow input bindings must be distinct.')
  if (parsed.duration.unit === 'frames') {
    const fps = parsed.duration.fps
    const offset = parsed.duration.frameOffset ?? 0
    if (fps === undefined || parsed.durations.some(duration => !Number.isSafeInteger(duration * fps + offset) || duration * fps + offset < 1)) throw new Error('Frame duration bindings require fps and frameOffset producing positive whole frame counts for every supported duration.')
  } else if (parsed.duration.fps !== undefined || parsed.duration.frameOffset !== undefined) throw new Error('Seconds duration bindings must omit fps and frameOffset.')
  if (new Set(parsed.durations).size !== parsed.durations.length) throw new Error('Workflow durations must be unique.')
  if (new Set(parsed.sizes.map(size => `${size.aspectRatio}/${size.resolution}`)).size !== parsed.sizes.length) throw new Error('Workflow dimension selections must be unique.')
  return { ...parsed, template, revision: createHash('sha256').update(JSON.stringify(parsed)).digest('hex') }
}

/**
 * Validate workflow data independently from a machine endpoint or runtime state.
 * @param input - Operator or imported workflow configuration.
 * @param maxBytes - Maximum serialized bytes per workflow configuration.
 * @returns Detached validated workflows with complete configuration revisions.
 */
export function resolveWorkflows(input: readonly ComfyWorkflow[], maxBytes: number): readonly ResolvedWorkflow[] {
  const workflows = input.map(workflow => resolveWorkflow(workflow, maxBytes))
  if (new Set(workflows.map(workflow => workflow.id)).size !== workflows.length) throw new Error('video-comfyui: workflow identities must be unique.')
  return workflows
}

/**
 * Resolve all defaults and reject invalid enabled settings before registering a target.
 * @param input - Operator configuration supplied by the Loader.
 * @returns Complete immutable-use configuration; no network requests occur.
 */
export function resolveConfig(input: Config): ResolvedConfig {
  const defaults = readConfig(Config(structuredClone(input) as Parameters<typeof Config>[0]))
  const resolved = {
    enabled: defaults.enabled, headers: defaults.headers, timeoutMs: defaults.timeoutMs,
    cleanupTimeoutMs: defaults.cleanupTimeoutMs, pollIntervalMs: defaults.pollIntervalMs,
    maxJsonBytes: defaults.maxJsonBytes, maxUploadBytes: defaults.maxUploadBytes, maxVideoBytes: defaults.maxVideoBytes,
    ...defaults.managedCapability === undefined ? {} : { managedCapability: defaults.managedCapability },
  }
  if (!resolved.enabled) return { ...resolved, baseURL: undefined, workflows: [] }
  if (!defaults.baseURL) throw new Error('video-comfyui: enabled requires baseURL.')
  const baseURL = resolveBaseURL(defaults.baseURL)
  for (const [key, value] of Object.entries(resolved.headers)) {
    if (/^(host|content-type|content-length|connection|transfer-encoding)$/i.test(key)) throw new Error(`video-comfyui: header ${key} is transport-owned.`)
    new Headers({ [key]: value })
  }
  const workflows = resolveWorkflows(defaults.workflows, resolved.maxJsonBytes)
  if (!workflows.length) throw new Error('video-comfyui: enabled requires nonempty uniquely named workflows.')
  return { ...resolved, baseURL, workflows }
}

/**
 * Validate the service address without contacting the endpoint.
 * @param value - Operator-supplied HTTP(S) address.
 * @returns Parsed address with a trailing path separator.
 */
export function resolveBaseURL(value: string): URL {
  const baseURL = new URL(value)
  if (!['http:', 'https:'].includes(baseURL.protocol) || baseURL.username || baseURL.password || baseURL.search || baseURL.hash) throw new Error('video-comfyui: baseURL must be an HTTP(S) origin or path prefix without credentials, query, or fragment.')
  baseURL.pathname = baseURL.pathname.replace(/\/?$/, '/')
  return baseURL
}
