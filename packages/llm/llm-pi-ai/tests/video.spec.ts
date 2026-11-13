import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { generateVideo } from '../src/video.ts'

const options = { pollIntervalMs: 3000, timeoutMs: 300000, headers: { 'X-Gateway-Key': 'private' } }
const request = { model: 'grok-imagine-video', prompt: 'A quiet garden' }
const ref = { attachmentId: 'video-id', mediaType: 'video/mp4', bytes: 3 }
function store() {
  const saveVideo = vi.fn().mockResolvedValue(ref)
  return { saveVideo, service: { saveVideo } as unknown as AttachmentStore }
}
function json(value: unknown) { return Response.json(value) }
function scripted(...responses: Response[]) {
  const mock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const response = responses.shift()
    if (response === undefined) throw new Error('Unexpected request')
    return response
  })
  vi.stubGlobal('fetch', mock)
  return mock
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('native video generation', () => {
  it('polls, resolves relative URLs, forwards provider headers, and saves with cancellation', async () => {
    vi.useFakeTimers()
    const target = store()
    const fetch = scripted(json({ request_id: 'job' }), json({ status: 'pending' }),
      json({ status: 'done', video: { url: '/v1/videos/job/content', duration: 6 } }),
      new Response('mp4', { headers: { 'Content-Type': 'video/mp4' } }))
    const result = generateVideo(request, 'https://gateway.example/v1/', 'secret', target.service, undefined, options)
    await vi.advanceTimersByTimeAsync(options.pollIntervalMs)
    await expect(result).resolves.toEqual({ type: 'video', attachment: ref })
    expect(fetch.mock.calls[3]?.[0]).toEqual(new URL('https://gateway.example/v1/videos/job/content'))
    expect(fetch.mock.calls[3]?.[1]?.redirect).toBe('error')
    const headers = new Headers(fetch.mock.calls[3]?.[1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer secret')
    expect(headers.get('X-Gateway-Key')).toBe('private')
    expect(target.saveVideo).toHaveBeenCalledWith({ data: Buffer.from('mp4'), mediaType: 'video/mp4', durationSeconds: 6 }, expect.any(AbortSignal))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not send provider credentials or custom headers to a CDN', async () => {
    const target = store()
    const fetch = scripted(json({ request_id: 'job' }), json({ status: 'done', video: { url: 'https://cdn.example/video' } }),
      new Response('mp4', { headers: { 'Content-Type': 'video/mp4' } }))
    await generateVideo(request, 'https://gateway.example/v1', 'secret', target.service, undefined, options)
    expect(fetch.mock.calls[2]?.[1]?.headers).toBeUndefined()
  })

  it('reads ordered durable references and sends verified image bytes only to generation', async () => {
    const refs: ImageAttachmentRef[] = ['character', 'scene'].map(name => ({
      attachmentId: AttachmentId(name), mediaType: 'image/png', bytes: name.length, width: 1, height: 1,
    }))
    const target = store()
    const readImage = vi.fn(async (ref: ImageAttachmentRef, signal?: AbortSignal) => {
      signal?.throwIfAborted()
      return { ref, data: Buffer.from(ref.attachmentId) }
    })
    target.service.readImage = readImage
    const fetch = scripted(json({ request_id: 'job' }), json({ status: 'done', video: { url: '/content' } }),
      new Response('mp4', { headers: { 'Content-Type': 'video/mp4' } }))
    await generateVideo(request, 'https://gateway.example/v1', 'secret', target.service, undefined, {
      ...options, referenceImages: refs,
    })
    expect(readImage.mock.calls.map(call => call[0])).toEqual(refs)
    expect(readImage.mock.calls.every(call => call[1] instanceof AbortSignal)).toBe(true)
    const body = fetch.mock.calls[0]?.[1]?.body
    if (typeof body !== 'string') throw new Error('Video generation must send a JSON request body')
    expect(JSON.parse(body)).toEqual({
      ...request,
      reference_images: refs.map(ref => ({ url: `data:image/png;base64,${Buffer.from(ref.attachmentId).toString('base64')}` })),
    })
    expect(fetch.mock.calls[1]?.[1]?.body).toBeUndefined()
    expect(fetch.mock.calls[2]?.[1]?.body).toBeUndefined()
  })

  it('cancels reference reads before submitting any paid request', async () => {
    const controller = new AbortController()
    const target = store()
    target.service.readImage = vi.fn(async (_ref: ImageAttachmentRef, signal?: AbortSignal) => {
      controller.abort(new Error('reference read stopped'))
      signal?.throwIfAborted()
      throw new Error('unreachable')
    })
    const fetch = scripted()
    await expect(generateVideo(request, 'https://gateway.example/v1', 'secret', target.service, controller.signal, {
      ...options, referenceImages: [{ attachmentId: AttachmentId('reference'), mediaType: 'image/png', bytes: 1, width: 1, height: 1 }],
    })).rejects.toThrow('reference read stopped')
    expect(fetch).not.toHaveBeenCalled()
    expect(target.saveVideo).not.toHaveBeenCalled()
  })

  it.each([
    [{ error: { message: 'rejected' } }, undefined, 'no valid request_id'],
    [{ request_id: 'job' }, { status: 'mystery' }, 'invalid status'],
    [{ request_id: 'job' }, { status: 'failed', error: 'moderated' }, 'moderated'],
    [{ request_id: 'job' }, { status: 'expired' }, 'expired'],
    [{ request_id: 'job' }, { status: 'done', video: {} }, 'no valid video URL'],
  ])('rejects invalid or terminal provider responses', async (submission, status, error) => {
    const target = store()
    scripted(json(submission), ...(status === undefined ? [] : [json(status)]))
    await expect(generateVideo(request, 'https://gateway.example/v1', 'secret', target.service, undefined, options)).rejects.toThrow(error)
    expect(target.saveVideo).not.toHaveBeenCalled()
  })

  it('rejects an HTML download rather than storing it as mp4', async () => {
    const target = store()
    scripted(json({ request_id: 'job' }), json({ status: 'done', video: { url: '/content' } }),
      new Response('<html>bad gateway</html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(generateVideo(request, 'https://gateway.example/v1', 'secret', target.service, undefined, options)).rejects.toThrow('unsupported Content-Type: text/html')
    expect(target.saveVideo).not.toHaveBeenCalled()
  })

  it('cancels during the poll delay and clears the deadline', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const target = store()
    scripted(json({ request_id: 'job' }), json({ status: 'pending' }))
    const result = generateVideo(request, 'https://gateway.example/v1', 'secret', target.service, controller.signal, options)
    const checked = expect(result).rejects.toThrow('stopped')
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(new Error('stopped'))
    await checked
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds a stalled submission by the total deadline', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const reason: unknown = init.signal?.reason
        reject(reason instanceof Error ? reason : new Error('Cancelled'))
      }, { once: true })
    })))
    const result = generateVideo(request, 'https://gateway.example/v1', 'secret', store().service, undefined, options)
    const checked = expect(result).rejects.toThrow('VIDEO_TIMEOUT')
    await vi.advanceTimersByTimeAsync(options.timeoutMs)
    await checked
    expect(vi.getTimerCount()).toBe(0)
  })

  it('passes cancellation into attachment persistence', async () => {
    const controller = new AbortController()
    const target = store()
    target.saveVideo.mockImplementation(async (_input: unknown, signal: AbortSignal) => {
      controller.abort(new Error('save stopped'))
      signal.throwIfAborted()
    })
    scripted(json({ request_id: 'job' }), json({ status: 'done', video: { url: '/content' } }),
      new Response('mp4', { headers: { 'Content-Type': 'video/mp4' } }))
    await expect(generateVideo(request, 'https://gateway.example/v1', 'secret', target.service, controller.signal, options)).rejects.toThrow('save stopped')
  })
})
