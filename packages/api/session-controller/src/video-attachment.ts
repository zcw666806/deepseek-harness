/** Session-log authorization and bounded transport for generated videos. */
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionVideoAttachmentRequest, SessionVideoAttachmentValue } from './types.ts'

// Raw-byte transport limit; base64 and the result envelope must fit one RPC frame.
const MAX_CHUNK_BYTES = 262144

function referencedVideo(events: readonly SessionEvent[], attachmentId: string): VideoAttachmentRef | undefined {
  const calls = new Set<string>()
  for (const event of events) {
    if (event.type === 'tool/call') {
      if (event.data.name === 'generate_video') calls.add(event.data.callId)
      continue
    }
    if (event.type !== 'tool/result') continue
    const source = event.data.message.source
    if (!calls.has(source.callId) || event.data.message.isError) continue
    const meta = event.data.meta
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta) || meta.type !== 'video') continue
    const ref = meta.attachment
    if (typeof ref !== 'object' || ref === null || Array.isArray(ref)
      || ref.attachmentId !== attachmentId
      || (ref.mediaType !== 'video/mp4' && ref.mediaType !== 'video/webm')
      || typeof ref.bytes !== 'number' || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) continue
    return ref as unknown as VideoAttachmentRef
  }
  return undefined
}

/**
 * Read one bounded video slice after matching a successful generation in the Session log.
 * @param ctx - Host attachment provider.
 * @param events - complete events of the already-authorized Session.
 * @param request - attachment identity and raw-byte offset and length.
 * @returns verified attachment metadata and one base64-encoded slice.
 */
export async function readSessionVideoAttachment(
  ctx: Context,
  events: readonly SessionEvent[],
  request: SessionVideoAttachmentRequest,
): Promise<SessionVideoAttachmentValue> {
  if (!Number.isSafeInteger(request.offset) || request.offset < 0
    || !Number.isSafeInteger(request.length) || request.length < 1 || request.length > MAX_CHUNK_BYTES) {
    throw new RemoteError('gateway/bad-request', `Video reads require a nonnegative byte offset and a length from 1 to ${MAX_CHUNK_BYTES}.`, {})
  }
  const ref = referencedVideo(events, String(request.attachmentId))
  if (ref === undefined) {
    throw new RemoteError('session/attachment-invalid', 'Video is not referenced by a successful generation in this session.', {
      reason: 'ATTACHMENT_NOT_REFERENCED',
    })
  }
  try {
    const stored = await ctx.attachments.readVideo(ref)
    if (request.offset > stored.data.byteLength) {
      throw new RemoteError('gateway/bad-request', 'Video byte offset exceeds the stored video length.', {})
    }
    const nextOffset = Math.min(stored.data.byteLength, request.offset + request.length)
    return {
      attachment: stored.ref,
      data: Buffer.from(stored.data.subarray(request.offset, nextOffset)).toString('base64'),
      offset: request.offset,
      nextOffset,
      total: stored.data.byteLength,
    }
  } catch (error) {
    if (error instanceof RemoteError) throw error
    if (error instanceof AttachmentError) {
      throw new RemoteError('session/attachment-invalid', error.message, { reason: error.code })
    }
    throw new RemoteError('gateway/internal', 'Unable to read video attachment.', {})
  }
}
