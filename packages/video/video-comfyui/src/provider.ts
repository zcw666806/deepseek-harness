/** Fixed-endpoint ComfyUI protocol with job-scoped cancellation and bounded bodies. */
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AttachmentStore, VideoMediaType } from '@deepseek-ai/dsh-attachment'
import type { VideoGenerationInput, VideoGenerationResult } from '@deepseek-ai/dsh-video-production/types'
import type { CapabilityHealth, CapabilityRequirement } from '@deepseek-ai/dsh-capability-manager/types'
import { z } from 'zod'
import type { ResolvedConfig } from './config.ts'
import type { ScalarBinding } from './types.ts'

type PromptId = Branded<'ComfyPromptId'>
type ClientId = Branded<'ComfyClientId'>

const object = z.record(z.string(), z.unknown())
const statusSchema = z.object({ status_str: z.enum(['success', 'error']), completed: z.boolean(), messages: z.array(z.unknown()) })
const outputSchema = z.object({ filename: z.string().min(1), subfolder: z.string(), type: z.literal('output') })

class TerminalJobError extends Error {}

async function bytes(response: Response, limit: number): Promise<Uint8Array> {
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel()
    throw new Error('ComfyUI response exceeds its configured byte limit.')
  }
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.byteLength
      if (total > limit) {
        await reader.cancel()
        throw new Error('ComfyUI response exceeds its configured byte limit.')
      }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks, total)
}

class Http {
  constructor(private readonly config: ResolvedConfig) {}

  async response(path: string, signal: AbortSignal, init: RequestInit = {}): Promise<Response> {
    const url = new URL(path, this.config.baseURL)
    const headers = new Headers(this.config.headers)
    if (typeof init.body === 'string') headers.set('content-type', 'application/json')
    const response = await fetch(url, { ...init, headers, redirect: 'error', signal })
    return response
  }

  async json(path: string, signal: AbortSignal, init: RequestInit = {}): Promise<{ status: number; value: unknown }> {
    if (typeof init.body === 'string' && Buffer.byteLength(init.body) > this.config.maxJsonBytes) throw new Error('ComfyUI request exceeds maxJsonBytes.')
    const response = await this.response(path, signal, init)
    const data = await bytes(response, this.config.maxJsonBytes)
    if (!response.ok) return { status: response.status, value: undefined }
    return { status: response.status, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) as unknown }
  }

  async requiredJson(path: string, signal: AbortSignal, init: RequestInit = {}): Promise<unknown> {
    const result = await this.json(path, signal, init)
    if (result.status < 200 || result.status >= 300) throw new Error(`ComfyUI ${path.split('?')[0]} returned HTTP ${result.status}.`)
    return result.value
  }

  async video(path: string, signal: AbortSignal, mediaType: VideoMediaType): Promise<Uint8Array> {
    const response = await this.response(path, signal)
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`ComfyUI /view returned HTTP ${response.status}.`)
    }
    const data = await bytes(response, this.config.maxVideoBytes)
    const magic = mediaType === 'video/mp4'
      ? Buffer.from(data.subarray(4, 8)).toString('ascii') === 'ftyp'
      : data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3
    if (!magic) throw new Error('ComfyUI output bytes do not match the selected MP4 or WebM format.')
    return data
  }
}

function setInput(template: Record<string, { inputs: Record<string, unknown> }>, binding: ScalarBinding, value: string | number): void {
  const node = template[binding.node] as { inputs: Record<string, unknown> }
  node.inputs[binding.input] = value
}

function outputPath(value: unknown, ownFolder: string): { query: string; mediaType: VideoMediaType; filename: string } {
  const output = outputSchema.parse(value)
  const subfolder = output.subfolder.replaceAll('\\', '/')
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_. -]*$/.test(output.filename) || !/\.(mp4|webm)$/.test(output.filename.toLowerCase())) throw new Error('ComfyUI video filename must be a plain MP4 or WebM basename.')
  if (subfolder !== '' && !subfolder.split('/').every(part => /^[A-Za-z0-9_-][A-Za-z0-9_. -]*$/.test(part) && part !== '..')) throw new Error('ComfyUI output subfolder must be a safe relative path.')
  if (subfolder !== ownFolder && !subfolder.startsWith(`${ownFolder}/`)) throw new Error('ComfyUI output is outside this operation\'s configured folder.')
  return {
    query: new URLSearchParams({ filename: output.filename, subfolder, type: 'output' }).toString(),
    mediaType: output.filename.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/webm', filename: output.filename,
  }
}

function historyEntry(value: unknown, id: PromptId, clientId: ClientId): Record<string, unknown> | undefined {
  const entry = object.parse(value)[id]
  if (entry === undefined) return undefined
  const parsed = object.parse(entry)
  const prompt = z.array(z.unknown()).parse(parsed['prompt'])
  if (prompt[1] !== id || object.parse(prompt[3])['client_id'] !== clientId) throw new Error('ComfyUI history does not belong to the submitted job and client.')
  return parsed
}

async function waitOutput(http: Http, id: PromptId, clientId: ClientId, config: ResolvedConfig, signal: AbortSignal): Promise<unknown> {
  while (true) {
    signal.throwIfAborted()
    const entry = historyEntry(await http.requiredJson(`history/${id}`, signal), id, clientId)
    if (entry) {
      const status = statusSchema.parse(entry['status'])
      const failure = status.messages.some(message => Array.isArray(message) && (message[0] === 'execution_error' || message[0] === 'execution_interrupted'))
      if (status.status_str === 'error' || failure) throw new TerminalJobError('ComfyUI job failed or was interrupted; inspect its server history for node diagnostics.')
      if (status.completed) {
        return entry['outputs']
      }
    }
    await delay(config.pollIntervalMs, undefined, { signal })
  }
}

async function cancelOwn(http: Http, id: PromptId, config: ResolvedConfig, signal: AbortSignal, acknowledged: boolean): Promise<void> {
  let dispatched = false
  while (true) {
    signal.throwIfAborted()
    const cancellation = await http.json(`api/jobs/${id}/cancel`, signal, { method: 'POST' })
    if (cancellation.status !== 200) throw new Error(`ComfyUI job-scoped cancellation returned HTTP ${cancellation.status}; remote termination is unconfirmed.`)
    dispatched ||= z.object({ cancelled: z.boolean() }).parse(cancellation.value).cancelled
    const current = await http.json(`api/jobs/${id}`, signal)
    if (current.status === 404 && (acknowledged || dispatched)) return
    if (current.status === 200) {
      const status = z.object({ id: z.literal(id), status: z.string() }).parse(current.value).status
      if (['completed', 'failed', 'cancelled'].includes(status)) return
      if (!['pending', 'in_progress'].includes(status)) throw new Error('ComfyUI cancellation returned an unknown job status; remote termination is unconfirmed.')
    } else if (current.status !== 404) throw new Error(`ComfyUI own-job status returned HTTP ${current.status}; remote termination is unconfirmed.`)
    // An unacknowledged submission may still be validating before it enters the queue.
    await delay(config.pollIntervalMs, undefined, { signal })
  }
}

/**
 * Execute one configured workflow and store only its selected verified video output.
 * Cancellation waits within cleanupTimeoutMs for this job's terminal state; uncertainty rejects explicitly.
 * @param attachments - Existing durable image and video storage.
 * @param config - Validated enabled provider configuration.
 * @param request - Resolved project input; model selects a configured workflow identity.
 * @param signal - Caller cancellation; submission is never retried.
 * @returns Durable video reference and the selected workflow identity.
 */
export async function generateComfyVideo(
  attachments: AttachmentStore,
  config: ResolvedConfig,
  request: VideoGenerationInput,
  signal: AbortSignal,
): Promise<VideoGenerationResult> {
  signal.throwIfAborted()
  const workflow = config.workflows.find(item => item.id === request.model)
  if (!workflow) throw new Error('ComfyUI generation requires a configured workflow model identity.')
  const size = workflow.sizes.find(item => item.aspectRatio === request.aspectRatio && item.resolution === request.resolution)
  if (!size || !workflow.durations.includes(request.duration) || request.referenceImages.length !== workflow.references.length) throw new Error('ComfyUI workflow does not support these dimensions, duration, or exact reference-image count.')
  const http = new Http(config)
  const id = brandString<PromptId>(randomUUID())
  const clientId = brandString<ClientId>(randomUUID())
  const folder = `dsh/${id}`
  const deadline = new AbortController()
  const timer = setTimeout(() => { deadline.abort(new Error('ComfyUI operation exceeded timeoutMs.')) }, config.timeoutMs)
  const active = AbortSignal.any([signal, deadline.signal])
  const cleanup = new AbortController()
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined
  const beginCleanup = (): void => {
    cleanupTimer ??= setTimeout(() => { cleanup.abort(new Error('ComfyUI remote termination is unconfirmed after cleanupTimeoutMs.')) }, config.cleanupTimeoutMs)
  }
  let submitted = false
  let acknowledged = false
  let terminal = false
  try {
    const template = structuredClone(workflow.template) as Record<string, { inputs: Record<string, unknown> }>
    setInput(template, workflow.prompt, request.prompt)
    setInput(template, workflow.duration, workflow.duration.unit === 'seconds' ? request.duration : request.duration * (workflow.duration.fps as number) + (workflow.duration.frameOffset ?? 0))
    setInput(template, workflow.width, size.width)
    setInput(template, workflow.height, size.height)
    setInput(template, workflow.outputPrefix, `${folder}/video`)
    let uploadedBytes = 0
    for (const [index, ref] of request.referenceImages.entries()) {
      const image = await attachments.readImage(ref, active)
      uploadedBytes += image.data.byteLength
      if (uploadedBytes > config.maxUploadBytes) throw new Error('ComfyUI reference images exceed maxUploadBytes.')
      const name = `reference-${index}.${ref.mediaType.split('/')[1]}`
      const form = new FormData()
      form.set('image', new Blob([Buffer.from(image.data)], { type: ref.mediaType }), name)
      form.set('type', 'input')
      form.set('subfolder', folder)
      form.set('overwrite', 'false')
      const uploaded = z.object({ name: z.literal(name), subfolder: z.literal(folder), type: z.literal('input') }).parse(await http.requiredJson('upload/image', active, { method: 'POST', body: form }))
      setInput(template, workflow.references[index] as ScalarBinding, `${uploaded.subfolder}/${uploaded.name}`)
    }
    active.throwIfAborted()
    const body = JSON.stringify({ prompt: template, prompt_id: id, client_id: clientId })
    if (Buffer.byteLength(body) > config.maxJsonBytes) throw new Error('ComfyUI submission exceeds maxJsonBytes.')
    active.addEventListener('abort', beginCleanup, { once: true })
    // Preserve the acknowledgment during caller cancellation; cleanup and total deadlines still bound this request.
    const submissionSignal = AbortSignal.any([deadline.signal, cleanup.signal])
    submitted = true
    const response = await http.json('prompt', submissionSignal, { method: 'POST', body })
    if (response.status >= 400 && response.status < 500) { terminal = true; throw new Error(`ComfyUI /prompt rejected the workflow with HTTP ${response.status}.`) }
    if (response.status !== 200) throw new Error(`ComfyUI /prompt returned HTTP ${response.status}; submission was not retried.`)
    const accepted = z.object({ prompt_id: z.literal(id), number: z.number() }).parse(response.value)
    void accepted
    acknowledged = true
    active.throwIfAborted()
    const outputs = await waitOutput(http, id, clientId, config, active)
    terminal = true
    const node = object.parse(object.parse(outputs)[workflow.output.node])
    const choices = z.array(z.unknown()).parse(node[workflow.output.key])
    if (choices[workflow.output.index] === undefined) throw new Error('ComfyUI history lacks the configured output node, key, or index.')
    const selected = outputPath(choices[workflow.output.index], folder)
    const data = await http.video(`view?${selected.query}`, active, selected.mediaType)
    active.throwIfAborted()
    const attachment = await attachments.saveVideo({ data, mediaType: selected.mediaType, name: selected.filename }, active)
    active.throwIfAborted()
    return { attachment, model: workflow.id }
  } catch (error) {
    if (submitted && !terminal && !(error instanceof TerminalJobError)) {
      beginCleanup()
      try { await cancelOwn(http, id, config, cleanup.signal, acknowledged) } catch (cancellationError) {
        throw new AggregateError([error, cancellationError], `ComfyUI generation failed; remote termination is unconfirmed for job ${id}.`)
      }
    }
    throw error
  } finally {
    active.removeEventListener('abort', beginCleanup)
    clearTimeout(timer)
    if (cleanupTimer !== undefined) clearTimeout(cleanupTimer)
  }
}

/**
 * Inspect configured node types and enumerated model references without submitting work.
 * @param config - Enabled validated workflow and endpoint settings.
 * @param signal - Explicit inspection cancellation and deadline.
 * @returns Missing node/model facts, or ready when the declared inputs are present.
 */
export async function inspectComfyWorkflows(config: ResolvedConfig, signal: AbortSignal): Promise<CapabilityHealth> {
  const http = new Http(config)
  const definitions = new Map<string, Record<string, unknown>>()
  const requirements: CapabilityRequirement[] = []
  for (const workflow of config.workflows) {
    for (const node of Object.values(workflow.template)) {
      signal.throwIfAborted()
      let definition = definitions.get(node.class_type)
      if (definition === undefined) {
        const result = await http.requiredJson(`object_info/${encodeURIComponent(node.class_type)}`, signal)
        const raw = object.parse(result)[node.class_type]
        if (raw === undefined) {
          requirements.push({ id: `node:${node.class_type}`, title: node.class_type, status: 'missing' })
          continue
        }
        definition = object.parse(raw)
        definitions.set(node.class_type, definition)
      }
      const input = object.parse(definition['input'])
      const required = object.parse(input['required'])
      for (const [key, value] of Object.entries(node.inputs)) {
        const field = required[key]
        if (!Array.isArray(field) || !Array.isArray(field[0])) continue
        const choices: unknown[] = field[0]
        if (!choices.every(choice => typeof choice === 'string' || typeof choice === 'number')) continue
        if ((typeof value === 'string' || typeof value === 'number') && !choices.includes(value)) {
          requirements.push({ id: `${workflow.id}:${key}`, title: `${workflow.title} · ${key}`, status: 'missing' })
        }
      }
    }
  }
  return { status: requirements.length ? 'missing' : 'ready', requirements }
}
