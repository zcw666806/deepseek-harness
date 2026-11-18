/** Draw one four-panel image through the configured provider and prepare editable PNG layers. */
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import sharp from 'sharp'
import { z } from 'zod'
import { failure } from './failure.ts'
import { prepareImage, type PreparedImage } from './images.ts'
import type { ComicDraft, ComicImageGenerationConfig } from './types.ts'

/** Validated provider endpoint and response policy. */
export interface StoryboardImageProvider {
  readonly endpoint: URL
  readonly credentialRef: CredentialRef
  readonly model: string
  readonly timeoutMs: number
  readonly imageOrigins: ReadonlySet<string>
}

const responseSchema = z.object({ data: z.array(z.object({ b64_json: z.string().nullish(), url: z.string().nullish() })).length(1) })

function secureURL(value: string, allowLoopback: boolean): URL {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' && loopback))
    || url.username || url.password || url.hash) throw new TypeError('Comic image URLs require HTTPS or explicit HTTP loopback.')
  return url
}

/**
 * Resolve the provider's generation route and allowed image origins at load.
 * @param config - Admin-supplied OpenAI-compatible image provider.
 * @returns The Host's validated provider configuration.
 */
export function resolveImageProvider(config: ComicImageGenerationConfig): StoryboardImageProvider {
  const base = secureURL(config.baseURL, true)
  if (base.search) throw new TypeError('The comic image base URL cannot contain a query string.')
  base.pathname = `${base.pathname.replace(/\/+$/u, '')}/images/generations`
  const imageOrigins = new Set((config.imageOrigins ?? []).map((value) => {
    const url = secureURL(value, false)
    if (url.pathname !== '/' || url.search) throw new TypeError('A comic image origin cannot include a path or query.')
    return url.origin
  }))
  return {
    endpoint: base, credentialRef: credentialRef(config.credentialRef), model: config.model,
    timeoutMs: config.timeoutMs ?? 180_000, imageOrigins,
  }
}

function imagePrompt(draft: ComicDraft, artDirection: string): string {
  const panels = draft.pages.flatMap(page => page.panels)
  return [
    `Draw a finished color comic titled “${draft.title}” as one square image containing four equal quadrants in a precise 2×2 grid.`,
    'The reading order is top left, top right, bottom left, bottom right. Fill each quadrant edge to edge. Keep the same character design, clothing and visual style across the four panels.',
    'Leave the top of any panel with dialogue visually quiet for later typesetting. Leave titles, captions, frame outlines and speech balloons out of the image. Draw lettering only when the scene specifies it as part of an object.',
    artDirection.trim(),
    ...panels.map((panel, index) => `Panel ${index + 1}: ${panel.description}\n${panel.notes}${panel.bubbles.length ? '\nLeave room for editable dialogue.' : ''}`),
  ].filter(Boolean).join('\n\n')
}

async function request(url: URL, init: RequestInit, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal, redirect: 'error' })
  } catch (_transportFailure) {
    if (signal.aborted) throw signal.reason
    failure('generation-unknown', 'The image request connection closed before the provider confirmed an outcome.')
  }
}

async function boundedBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  if (response.body === null) failure('generation-response', 'The image service returned an empty response.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) return Buffer.concat(chunks, length)
      length += chunk.value.byteLength
      if (length > maxBytes) failure('generation-response', 'The image service response exceeded the configured limit.')
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => { /* A failed or completed response has no remaining bytes to read. */ })
    reader.releaseLock()
  }
}

function checkResponse(response: Response): void {
  if (response.ok) return
  void response.body?.cancel().catch(() => { /* No response content is used after a rejected request. */ })
  if (response.status >= 500) failure('generation-unknown', `The image service returned HTTP ${response.status} before confirming an outcome.`)
  failure('generation-request', `The image service rejected the request (HTTP ${response.status}).`)
}

async function sheetBytes(
  provider: StoryboardImageProvider, credential: string, prompt: string, maxBytes: number, signal: AbortSignal,
): Promise<Buffer> {
  const response = await request(provider.endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: provider.model, prompt, n: 1, aspect_ratio: '1:1', response_format: 'b64_json' }),
  }, signal)
  checkResponse(response)
  const encoded = await boundedBody(response, Math.ceil(maxBytes / 3) * 4 + 65_536, signal)
  let value: unknown
  try {
    value = JSON.parse(encoded.toString('utf8'))
  } catch (_invalidJson) {
    failure('generation-response', 'The image service returned an unreadable response.')
  }
  const parsed = responseSchema.safeParse(value)
  const image = parsed.success ? parsed.data.data[0] : undefined
  if (typeof image?.b64_json === 'string') {
    const bytes = Buffer.from(image.b64_json, 'base64')
    if (bytes.length === 0 || bytes.length > maxBytes || bytes.toString('base64') !== image.b64_json) {
      failure('generation-response', 'The generated image data is invalid or exceeds the configured limit.')
    }
    return bytes
  }
  const url = typeof image?.url === 'string' ? URL.parse(image.url) : null
  if (url === null || url.protocol !== 'https:' || url.username || url.password
    || !provider.imageOrigins.has(url.origin)) {
    failure('generation-response', 'The image service returned no embedded image or approved image URL.')
  }
  const download = await request(url, {}, signal)
  checkResponse(download)
  return await boundedBody(download, maxBytes, signal)
}

/**
 * Submit one provider request and crop its image into four ordered PNG layers.
 * @param provider - Validated image route and policy.
 * @param credential - Resolved secret used for the generation request only.
 * @param draft - Validated four-panel draft in reading order.
 * @param artDirection - Style and visual continuity from the source message.
 * @param limits - Maximum encoded image bytes and decoded image pixels.
 * @param signal - Service shutdown signal.
 * @returns Four independently editable, validated originals in reading order.
 */
export async function generateStoryboardArtwork(
  provider: StoryboardImageProvider, credential: string, draft: ComicDraft, artDirection: string,
  limits: { readonly maxImageBytes: number; readonly maxImagePixels: number }, signal: AbortSignal,
): Promise<PreparedImage[]> {
  const timeout = AbortSignal.timeout(provider.timeoutMs)
  const operation = AbortSignal.any([signal, timeout])
  let encoded: Buffer
  try {
    encoded = await sheetBytes(provider, credential, imagePrompt(draft, artDirection), limits.maxImageBytes, operation)
  } catch (error) {
    signal.throwIfAborted()
    if (timeout.aborted) failure('generation-timeout', 'The image service did not confirm an outcome before the request timed out.')
    if (error instanceof RemoteError) throw error
    failure('generation-unknown', 'The image request connection closed before the provider confirmed an outcome.')
  }
  const sheet = sharp(encoded, { limitInputPixels: limits.maxImagePixels, failOn: 'warning' })
  const images: PreparedImage[] = []
  try {
    const metadata = await sheet.metadata()
    const width = Math.floor(metadata.width / 2)
    const height = Math.floor(metadata.height / 2)
    if ((metadata.pages ?? 1) !== 1 || (metadata.orientation ?? 1) !== 1 || width < 1 || height < 1) {
      failure('generation-response', 'The image service must return one upright image large enough for four panels.')
    }
    for (let panel = 0; panel < 4; panel++) {
      signal.throwIfAborted()
      const png = await sheet.clone().extract({
        left: (panel % 2) * width, top: Math.floor(panel / 2) * height, width, height,
      }).png().toBuffer()
      images.push(await prepareImage(png.toString('base64'), limits.maxImageBytes, limits.maxImagePixels))
    }
  } catch (_invalidArtwork) {
    signal.throwIfAborted()
    failure('generation-response', 'The image service returned artwork that could not be prepared as four PNG layers.')
  }
  return images
}
