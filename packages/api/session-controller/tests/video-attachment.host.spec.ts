import { Context } from '@deepseek-ai/cordis'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSessionVideoAttachment } from '../src/video-attachment.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

const attachment: VideoAttachmentRef = {
  attachmentId: AttachmentId('generated-video'), mediaType: 'video/mp4', bytes: 4, durationSeconds: 1,
}

function events(name = 'generate_video', isError = false): SessionEvent[] {
  return [
    { type: 'tool/call', seq: 1, time: 1, data: { callId: 'call', name, arguments: '{}', turn: 1, step: 1 } },
    {
      type: 'tool/result', seq: 2, time: 2,
      data: {
        turn: 1, step: 1,
        message: {
          id: 'message', role: 'tool', source: { kind: 'tool', callId: 'call' },
          toolCallId: 'call', content: [], isError,
        },
        meta: { type: 'video', attachment },
      },
    },
  ] as SessionEvent[]
}

function harness(): { ctx: Context; readVideo: ReturnType<typeof vi.fn> } {
  const ctx = new Context()
  contexts.push(ctx)
  const readVideo = vi.fn(async () => ({ ref: attachment, data: Uint8Array.of(1, 2, 3, 4) }))
  ctx.provide('attachments', { readVideo } as never)
  return { ctx, readVideo }
}

const request = { sessionId: SessionId('session'), attachmentId: attachment.attachmentId, offset: 1, length: 2 }

describe('generated video attachment transport', () => {
  it('returns the requested bounded range and permits an empty terminal read', async () => {
    const { ctx } = harness()
    await expect(readSessionVideoAttachment(ctx, events(), request)).resolves.toEqual({
      attachment, data: 'AgM=', offset: 1, nextOffset: 3, total: 4,
    })
    await expect(readSessionVideoAttachment(ctx, events(), { ...request, offset: 4 })).resolves.toMatchObject({
      data: '', offset: 4, nextOffset: 4, total: 4,
    })
  })

  it('rejects another session log, failed results, and unrelated tool metadata before storage access', async () => {
    const { ctx, readVideo } = harness()
    for (const records of [[], events('other_tool'), events('generate_video', true), events().slice(1)]) {
      await expect(readSessionVideoAttachment(ctx, records, request)).rejects.toMatchObject({
        code: 'session/attachment-invalid',
      })
    }
    expect(readVideo).not.toHaveBeenCalled()
  })

  it('rejects invalid and oversized ranges', async () => {
    const { ctx, readVideo } = harness()
    for (const range of [{ offset: -1 }, { offset: 0.5 }, { length: 0 }, { length: 262145 }]) {
      await expect(readSessionVideoAttachment(ctx, events(), { ...request, ...range })).rejects.toMatchObject({
        code: 'gateway/bad-request',
      })
    }
    expect(readVideo).not.toHaveBeenCalled()
    await expect(readSessionVideoAttachment(ctx, events(), { ...request, offset: 5 })).rejects.toMatchObject({
      code: 'gateway/bad-request',
    })
  })

  it('preserves attachment diagnostics and contains other storage failures', async () => {
    const { ctx, readVideo } = harness()
    readVideo.mockRejectedValueOnce(new AttachmentError('missing', 'ATTACHMENT_NOT_FOUND'))
    await expect(readSessionVideoAttachment(ctx, events(), request)).rejects.toMatchObject({
      code: 'session/attachment-invalid',
    })
    readVideo.mockRejectedValueOnce(new Error('offline'))
    await expect(readSessionVideoAttachment(ctx, events(), request)).rejects.toMatchObject({ code: 'gateway/internal' })
  })
})
