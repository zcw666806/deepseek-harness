import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { generateConfiguredVideo } from '../src/configured-video.ts'
import { resolveProfiles } from '../src/config.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  vi.unstubAllGlobals()
})

function profiles(model: string) {
  return resolveProfiles({ video: {
    api: 'openai-completions', baseURL: 'https://video.invalid/v1',
    defaultContextWindow: 8192, defaultMaxTokens: 1024,
    videoPollIntervalMs: 1, videoTimeoutMs: 5000,
    headers: { 'X-Video-Route': 'project' },
    models: [{ id: model, output: ['video'] }],
  } })
}

function context(store?: Pick<AttachmentStore, 'readImage' | 'saveVideo'>) {
  const ctx = new Context()
  contexts.push(ctx)
  if (store !== undefined) ctx.provide('attachments', store)
  return ctx
}

const image: ImageAttachmentRef = {
  attachmentId: AttachmentId('character'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
}

describe('configured video targets', () => {
  it('rejects missing storage, unconfigured models, and absent credentials before generation', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const resolveApiKey = vi.fn(async () => undefined)
    await expect(generateConfiguredVideo(context(), profiles('video'), resolveApiKey, { prompt: 'A scene' })).rejects.toThrow('attachments service')
    const ctx = context({ readImage: vi.fn(), saveVideo: vi.fn() })
    await expect(generateConfiguredVideo(ctx, profiles('video'), resolveApiKey, { prompt: 'A scene', model: 'unknown' })).rejects.toThrow('no configured model "unknown"')
    await expect(generateConfiguredVideo(ctx, new Map(), resolveApiKey, { prompt: 'A scene' })).rejects.toThrow('no video-capable model')
    await expect(generateConfiguredVideo(ctx, profiles('video'), resolveApiKey, { prompt: 'A scene' })).rejects.toThrow('resolved no credential')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['custom-video', 1, 6, 'no declared native reference-image support'],
    ['grok-imagine-video', 8, 6, 'at most 7 reference images'],
    ['grok-imagine-video-1.5', 15, 6, 'at most 14 reference images'],
    ['grok-imagine-video', 1, 11, 'at most 10 seconds'],
  ])('refuses unsupported native references without requesting credentials or generating', async (model, count, duration, error) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const resolveApiKey = vi.fn(async () => 'secret')
    await expect(generateConfiguredVideo(context({ readImage: vi.fn(), saveVideo: vi.fn() }), profiles(model), resolveApiKey, {
      prompt: 'A scene', duration, referenceImages: Array.from({ length: count }, () => image),
    })).rejects.toThrow(error)
    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['grok-imagine-video', 'grok-imagine-video-1.5'])('generates with a configured reference-capable model and records its identity', async (model) => {
    const attachment = { attachmentId: AttachmentId('result'), mediaType: 'video/mp4' as const, bytes: 3 }
    const readImage = vi.fn(async () => ({ ref: image, data: Buffer.from('i') }))
    const saveVideo = vi.fn(async () => attachment)
    const responses = [Response.json({ request_id: 'job' }), Response.json({ status: 'done', video: { url: '/content' } }),
      new Response('mp4', { headers: { 'Content-Type': 'video/mp4' } })]
    const fetch = vi.fn(async () => responses.shift()!)
    vi.stubGlobal('fetch', fetch)
    const resolveApiKey = vi.fn(async () => 'secret')
    const ctx = context({ readImage, saveVideo })
    await expect(generateConfiguredVideo(ctx, profiles(model), resolveApiKey, {
      prompt: 'The character walks into the scene', model, duration: 6,
      aspect_ratio: '16:9', resolution: '720p', referenceImages: [image],
    })).resolves.toEqual({ attachment, model })
    expect(readImage).toHaveBeenCalledWith(image, expect.any(AbortSignal))
    expect(saveVideo).toHaveBeenCalled()
    expect(resolveApiKey).toHaveBeenCalledWith('video', expect.any(Object), undefined)
  })
})
