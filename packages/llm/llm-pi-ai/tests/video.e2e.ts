import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { generateVideo } from '../src/video.ts'

const apiKey = process.env.DSH_VIDEO_API_KEY
const baseURL = process.env.DSH_VIDEO_BASE_URL
const model = process.env.DSH_VIDEO_MODEL

describe.skipIf(!apiKey || !baseURL || !model)('configured native video provider', () => {
  it('downloads and verifies a generated video in local attachment storage', { timeout: 360000, retry: 0 }, async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-video-provider-'))
    const ctx = new Context()
    try {
      await ctx.plugin(LocalAttachmentStore, { dshHome: home })
      const block = await generateVideo({
        model: model!, prompt: 'A single green leaf moving gently in sunlight, static camera.',
        duration: 1, resolution: '480p',
      }, baseURL!, apiKey!, ctx.attachments, undefined, { pollIntervalMs: 3000, timeoutMs: 300000 })
      const stored = await ctx.attachments.readVideo(block.attachment)
      expect(stored.data.byteLength).toBeGreaterThan(0)
      expect(stored.data.byteLength).toBe(block.attachment.bytes)
      expect(['video/mp4', 'video/webm']).toContain(block.attachment.mediaType)
      if (block.attachment.mediaType === 'video/mp4') {
        expect(Buffer.from(stored.data).subarray(4, 8).toString('ascii')).toBe('ftyp')
      }
      const output = process.env.DSH_VIDEO_OUTPUT_PATH
      if (output !== undefined) await writeFile(output, stored.data)
      console.info('Video verification:', JSON.stringify({
        bytes: stored.data.byteLength, mediaType: block.attachment.mediaType,
        durationSeconds: block.attachment.durationSeconds, output,
      }))
    } finally {
      await ctx.fiber.dispose()
      await rm(home, { recursive: true, force: true })
    }
  })
})
