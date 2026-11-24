import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import type { VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { DescribeVideoGenerator, VideoGenerator } from '@deepseek-ai/dsh-video-production/types'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'

let root: string | undefined
let context: Context | undefined

class ProjectGeneratorRegistry extends Service {
  readonly generators = new Map<string, VideoGenerator>()
  readonly descriptions = new Map<string, DescribeVideoGenerator>()

  constructor(ctx: Context) {
    super(ctx, 'videoProduction')
  }

  registerGenerator(name: string, generator: VideoGenerator, describe: DescribeVideoGenerator): () => void {
    const dispose = this.ctx.effect(() => {
      this.generators.set(name, generator)
      this.descriptions.set(name, describe)
      return () => { this.generators.delete(name); this.descriptions.delete(name) }
    })
    return () => { void dispose() }
  }

  selectedConversationVideoModel(): string | undefined { return undefined }
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function settings(model: string, baseURL: string, key: string): LlmPiAi.Options {
  return { providers: { gateway: {
    api: 'openai-completions', baseURL, apiKeyEnv: key,
    headers: { 'X-Video-Route': 'configured-header' },
    defaultContextWindow: 8192, defaultMaxTokens: 1024,
    videoPollIntervalMs: 1, videoTimeoutMs: 5000,
    models: [{ id: model, output: ['text', 'video'] }],
  } } }
}

async function loadComposition(production = false) {
  root = await mkdtemp(join(tmpdir(), 'dsh-video-composition-'))
  const ctx = new Context()
  context = ctx
  const credentialsPath = join(root, '.credentials.yaml')
  await writeFile(credentialsPath, 'version: 1\nrefs:\n  VIDEO_FIRST: first-key\n  VIDEO_SECOND: second-key\n', { mode: 0o600 })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(LocalCredentialProvider, { path: credentialsPath, watch: false })
  if (production) await ctx.plugin(ProjectGeneratorRegistry)
  const configuration = await liveConfig(ctx, LlmPiAi, settings('first-video', 'https://first.invalid/v1', 'VIDEO_FIRST'))
  expect(configuration.entry.fiber).toBeDefined()
  expect(ctx.llm.listProviders().map(provider => provider.id)).toContain('gateway')
  expect(ctx.tools.get('generate_video')).toBeDefined()
  return { ctx, configuration, home: root }
}

function mockGeneration() {
  const requests: { url: string; authorization: string | null; routeHeader: string | null; body: unknown }[] = []
  let pending = true
  const bytes = Buffer.from('generated-video-bytes')
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
    if (init?.body !== undefined && typeof init.body !== 'string') throw new Error('Video request body must be JSON text')
    const body: unknown = init?.body === undefined ? undefined : JSON.parse(init.body)
    requests.push({ url, authorization: new Headers(init?.headers).get('authorization'), routeHeader: new Headers(init?.headers).get('x-video-route'), body })
    if (url.endsWith('/videos/generations')) return Response.json({ request_id: 'generated' })
    if (url.endsWith('/videos/generated')) {
      if (pending) { pending = false; return Response.json({ status: 'pending' }) }
      return Response.json({ status: 'done', video: { url: '/v1/videos/generated/content', duration: 6 } })
    }
    if (url.endsWith('/videos/generated/content')) return new Response(bytes, { headers: { 'content-type': 'video/mp4' } })
    throw new Error(`Unexpected fetch: ${url}`)
  }))
  return { requests, bytes }
}

function execute(ctx: Context, args: Record<string, JsonValue> = { prompt: 'A cat playing piano' }) {
  return executeToolFixture(ctx, { signal: new AbortController().signal, callId: ToolCallId('video-call'), name: 'generate_video', arguments: args })
}

describe('generate_video Loader composition', () => {
  it('uses the initiating Session selection ahead of the tool model argument', async () => {
    const { requests } = mockGeneration()
    const { ctx, home } = await loadComposition(true)
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const session = Session.create(SessionId('video-model-selection'))
    session.append('turn/start', { turn: 1 })
    const selection = vi.spyOn(ctx.videoProduction, 'selectedConversationVideoModel').mockReturnValue('first-video')
    const result = await executeToolFixture(ctx, {
      signal: new AbortController().signal, callId: ToolCallId('video-call'),
      name: 'generate_video', arguments: { prompt: 'A lake in autumn', model: 'unconfigured-video' },
      agent: { id: session.id, session } as NonNullable<ToolExecutionInput['agent']>,
    })
    expect(result.isError).toBe(false)
    expect(selection).toHaveBeenCalledWith(session.id, session.header.createdAt)
    expect(requests[0]?.body).toMatchObject({ model: 'first-video' })
  })
  it.each(['active', 'retiring'] as const)('awaits %s project generation when the adapter unloads', async (state) => {
    const submitted = Promise.withResolvers<boolean>()
    const releaseProvider = Promise.withResolvers<boolean>()
    let providerSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      providerSignal = init?.signal ?? undefined
      submitted.resolve(true)
      return await new Promise<Response>((_resolve, reject) => {
        providerSignal?.addEventListener('abort', () => {
          void releaseProvider.promise.then(() => {
            const reason: unknown = providerSignal?.reason
            reject(reason instanceof Error ? reason : new Error('Video provider cancelled'))
          })
        }, { once: true })
      })
    }))
    const { ctx, home, configuration } = await loadComposition(true)
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const registry = ctx.get('videoProduction') as unknown as ProjectGeneratorRegistry
    const generate = registry.generators.get('llm-pi-ai')!
    const pending = generate({
      sessionId: SessionId('video-project-session'), prompt: 'A scene', duration: 6,
      aspectRatio: '16:9', resolution: '480p', referenceImages: [], model: 'first-video',
    }, new AbortController().signal)
    const checked = expect(pending).rejects.toThrow('provider was unloaded')
    const adapter = configuration.entry
    let unloaded = false
    let unload: Promise<void> | undefined
    try {
      await submitted.promise
      if (state === 'retiring') {
        await configuration.replace({ providers: {} })
        await vi.waitFor(() => { expect(registry.generators.size).toBe(0) })
      }
      unload = adapter?.fiber?.dispose().then(() => { unloaded = true })
      await vi.waitFor(() => { expect(providerSignal?.aborted).toBe(true) })
      expect(unloaded).toBe(false)
    } finally {
      releaseProvider.resolve(true)
      await unload
      await checked
    }
    expect(providerSignal?.aborted).toBe(true)
    expect(registry.generators.size).toBe(0)
  })

  it('contributes a project generator that follows live profiles and leaves on adapter disposal', async () => {
    const { requests } = mockGeneration()
    const { ctx, configuration, home } = await loadComposition(true)
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const registry = ctx.get('videoProduction') as unknown as ProjectGeneratorRegistry
    await vi.waitFor(() => { expect(registry.generators.has('llm-pi-ai')).toBe(true) })
    const generate = registry.generators.get('llm-pi-ai')!
    const request = {
      sessionId: SessionId('video-project-session'), prompt: 'A scene', duration: 6,
      aspectRatio: '16:9' as const, resolution: '720p' as const, referenceImages: [],
    }
    expect(registry.descriptions.get('llm-pi-ai')?.()).toEqual([{
      title: 'gateway', model: 'first-video', limits: { maxReferenceImages: 0 },
    }])
    const first = await generate(request, new AbortController().signal)
    expect(first).toMatchObject({ model: 'first-video', attachment: { mediaType: 'video/mp4' } })
    await configuration.replace(settings('second-video', 'https://second.invalid/v1/', 'VIDEO_SECOND'))
    expect(registry.generators.get('llm-pi-ai')).toBe(generate)
    expect(registry.descriptions.get('llm-pi-ai')?.()).toEqual([{
      title: 'gateway', model: 'second-video', limits: { maxReferenceImages: 0 },
    }])
    await expect(generate(request, new AbortController().signal)).resolves.toMatchObject({ model: 'second-video' })
    expect(requests.find(item => item.url === 'https://second.invalid/v1/videos/generations')).toMatchObject({
      authorization: 'Bearer second-key', routeHeader: 'configured-header',
      body: { model: 'second-video', aspect_ratio: '16:9', resolution: '720p' },
    })
    await configuration.replace({ providers: {} })
    await vi.waitFor(() => { expect(registry.generators.size).toBe(0) })
    await configuration.replace(settings('third-video', 'https://third.invalid/v1/', 'VIDEO_FIRST'))
    await vi.waitFor(() => { expect(registry.generators.size).toBe(1) })
    const adapter = configuration.entry
    await adapter?.fiber?.dispose()
    expect(registry.generators.size).toBe(0)
  })

  it('stores video with a late attachment provider and follows live route credentials and models', async () => {
    const { requests, bytes } = mockGeneration()
    const { ctx, configuration, home } = await loadComposition()
    const tool = ctx.tools.get('generate_video')
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    const first = await execute(ctx)
    expect(first.isError).toBe(false)
    expect(first.value).toMatchObject({ type: 'video', attachment: { mediaType: 'video/mp4', bytes: bytes.length, durationSeconds: 6 } })
    const ref = (first.value as unknown as { attachment: VideoAttachmentRef }).attachment
    expect((await ctx.attachments.readVideo(ref)).data).toEqual(bytes)
    expect(first.meta).toEqual(first.value)
    expect(first.content).toHaveLength(1)
    expect(first.content[0]).toMatchObject({ type: 'text' })
    if (first.content[0]?.type !== 'text') throw new Error('Expected video summary text')
    expect(first.content[0].text).toContain('Video generated (video/mp4')
    expect(requests[0]).toMatchObject({ url: 'https://first.invalid/v1/videos/generations', authorization: 'Bearer first-key', routeHeader: 'configured-header', body: { model: 'first-video' } })
    expect(requests.every(request => request.routeHeader === 'configured-header')).toBe(true)

    await configuration.replace(settings('second-video', 'https://second.invalid/v1/', 'VIDEO_SECOND'))
    expect(ctx.tools.get('generate_video')).toBe(tool)
    const second = await execute(ctx)
    expect(second.isError).toBe(false)
    expect(requests.find(request => request.url === 'https://second.invalid/v1/videos/generations')).toMatchObject({ authorization: 'Bearer second-key', body: { model: 'second-video' } })
    await configuration.replace({ providers: {} })
    await vi.waitFor(() => { expect(ctx.tools.get('generate_video')).toBeUndefined() })
  })

  it('rejects invalid durations before requesting a video and removes the tool on disposal', async () => {
    const { requests } = mockGeneration()
    const { ctx, configuration, home } = await loadComposition()
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    for (const duration of [0, 16, 1.5]) {
      const result = await execute(ctx, { prompt: 'A cat', duration })
      expect(result.isError).toBe(true)
    }
    expect(requests).toEqual([])
    const entry = configuration.entry
    expect(entry?.fiber).toBeDefined()
    await entry?.fiber?.dispose()
    expect(ctx.tools.get('generate_video')).toBeUndefined()
  })

  it('uses native xAI credentials and its inherited endpoint without route overrides', async () => {
    vi.stubEnv('XAI_API_KEY', 'native-key')
    const { requests } = mockGeneration()
    const { ctx, configuration, home } = await loadComposition()
    await ctx.plugin(LocalAttachmentStore, { dshHome: home })
    await configuration.replace({ providers: { xai: {
      api: 'openai-completions',
      models: [{ id: 'native-video', output: ['video'] }],
      videoPollIntervalMs: 1, videoTimeoutMs: 5000,
    } } })
    const result = await execute(ctx)
    expect(result.isError).toBe(false)
    expect(requests[0]).toMatchObject({
      url: 'https://api.x.ai/v1/videos/generations',
      authorization: 'Bearer native-key',
      body: { model: 'native-video' },
    })
  })
})
