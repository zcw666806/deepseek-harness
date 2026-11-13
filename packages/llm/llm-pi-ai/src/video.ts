/**
 * Native xAI asynchronous video generation and durable attachment storage.
 * @module @deepseek-ai/dsh-llm-pi-ai/video
 */
import { setTimeout as delay } from 'node:timers/promises'
import { deadline } from '@deepseek-ai/dsh-timeout'
import type { VideoBlock } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/** Parameters accepted by the native video generation endpoint. */
export interface VideoGenerationRequest {
  /** Configured video model identifier. */
  model: string
  /** Description of the requested video. */
  prompt: string
  /** Requested aspect ratio. */
  aspect_ratio?: string
  /** Requested duration in seconds. */
  duration?: number
  /** Requested output resolution. */
  resolution?: string
}

/** Deployment headers and timing budgets for one generation. */
export interface VideoGenerationOptions {
  /** Provider headers, sent only to the provider origin. */
  headers?: Readonly<Record<string, string>>
  /** Delay between pending status polls in milliseconds. */
  pollIntervalMs: number
  /** Total generation, download, and persistence budget in milliseconds. */
  timeoutMs: number
  /** Durable character or scene references, read within the total deadline. */
  referenceImages?: readonly ImageAttachmentRef[]
}

function object(value: unknown, operation: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Video ${operation} returned an invalid JSON object`)
  }
  return value as Record<string, unknown>
}

async function responseJson(response: Response, operation: string): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new Error(`Video ${operation} failed (${response.status}): ${await response.text()}`)
  }
  let value: unknown
  try {
    value = await response.json()
  } catch (error) {
    throw new Error(`Video ${operation} returned invalid JSON`, { cause: error })
  }
  return object(value, operation)
}

/**
 * Submit and poll native xAI video generation, then persist its downloaded media.
 * Provider credentials accompany same-origin downloads only. Cancellation and the
 * total deadline remain active through attachment persistence.
 * @param request - Native generation parameters.
 * @param baseURL - Provider API base URL, including its version prefix.
 * @param apiKey - Resolved provider credential.
 * @param attachmentStore - Durable video storage.
 * @param signal - Caller cancellation signal.
 * @param options - Deployment headers and timing budgets.
 * @returns The persisted video attachment block.
 */
export async function generateVideo(
  request: VideoGenerationRequest,
  baseURL: string,
  apiKey: string,
  attachmentStore: AttachmentStore,
  signal: AbortSignal | undefined,
  options: VideoGenerationOptions,
): Promise<VideoBlock> {
  using operation = deadline(signal, options.timeoutMs, 'VIDEO_TIMEOUT')
  const active = operation.signal
  const base = `${baseURL.replace(/\/+$/, '')}/`
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${apiKey}`)
  headers.set('Content-Type', 'application/json')
  active.throwIfAborted()
  try {
    const referenceImages: { url: string }[] = []
    for (const reference of options.referenceImages ?? []) {
      const image = await attachmentStore.readImage(reference, active)
      active.throwIfAborted()
      referenceImages.push({ url: `data:${image.ref.mediaType};base64,${Buffer.from(image.data).toString('base64')}` })
    }
    const submitted = await responseJson(await fetch(new URL('videos/generations', base), {
      method: 'POST', headers,
      body: JSON.stringify({ ...request, ...referenceImages.length === 0 ? {} : { reference_images: referenceImages } }),
      signal: active,
    }), 'generation request')
    if (typeof submitted.request_id !== 'string' || submitted.request_id.trim().length === 0) {
      throw new Error(`Video generation response has no valid request_id: ${JSON.stringify(submitted)}`)
    }
    const pollUrl = new URL(`videos/${encodeURIComponent(submitted.request_id)}`, base)
    while (true) {
      active.throwIfAborted()
      const status = await responseJson(await fetch(pollUrl, { headers, signal: active }), 'status poll')
      if (status.status === 'failed' || status.status === 'expired') {
        throw new Error(`Video generation ${status.status}: ${JSON.stringify(status.error ?? status)}`)
      }
      if (status.status === 'pending' || status.status === 'processing') {
        await delay(options.pollIntervalMs, undefined, { signal: active })
        continue
      }
      if (status.status !== 'done') {
        throw new Error(`Video status response has an invalid status: ${JSON.stringify(status)}`)
      }
      const video = object(status.video, 'completed status')
      if (typeof video.url !== 'string' || video.url.trim().length === 0) {
        throw new Error('Video generation completed but no valid video URL was returned')
      }
      const target = new URL(video.url, base)
      if (target.protocol !== 'https:' && target.protocol !== 'http:') {
        throw new Error(`Video download URL has unsupported protocol: ${target.protocol}`)
      }
      const download = await fetch(target, {
        ...(target.origin === new URL(base).origin ? { headers, redirect: 'error' as const } : {}),
        signal: active,
      })
      if (!download.ok) throw new Error(`Video download failed (${download.status}): ${await download.text()}`)
      const mediaType = download.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
      if (mediaType !== 'video/mp4' && mediaType !== 'video/webm') {
        throw new Error(`Video download returned unsupported Content-Type: ${mediaType ?? 'missing'}`)
      }
      const data = Buffer.from(await download.arrayBuffer())
      active.throwIfAborted()
      if (video.duration !== undefined && (typeof video.duration !== 'number' || !Number.isFinite(video.duration) || video.duration <= 0)) {
        throw new Error('Video completed status has an invalid duration')
      }
      const attachment = await attachmentStore.saveVideo({
        data, mediaType,
        ...(typeof video.duration === 'number' ? { durationSeconds: video.duration } : {}),
      }, active)
      active.throwIfAborted()
      return { type: 'video', attachment }
    }
  } catch (error) {
    active.throwIfAborted()
    throw error
  }
}
