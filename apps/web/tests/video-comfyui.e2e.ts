/** Real native ComfyUI/API and FFmpeg round trip; this explicitly creates black frames, not AI-generated media. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { VideoShotId } from '@deepseek-ai/dsh-video-production/types'
import type { ComfyWorkflow } from '@deepseek-ai/dsh-video-comfyui'
import type {} from '@deepseek-ai/dsh-video-production'
import { launchWebScaffold, seedSession, webSnapshotMode, type WebScaffold, selectedSessionFixture } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'

const execute = promisify(execFile)
const COMFY = process.env.DSH_TEST_COMFYUI_URL
const FFMPEG = process.env.DSH_TEST_FFMPEG_PATH
const FFPROBE = process.env.DSH_TEST_FFPROBE_PATH
const SESSION = SessionId('comfyui-native-diagnostic')
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.v4.jsonl', import.meta.url))
const TITLE = '无模型接口自检 · 原生黑帧'

interface NativeNode {
  input: { required: Record<string, readonly unknown[]> }
  output: string[]
  output_node: boolean
}
interface Probe {
  streams: { codec_type: string; codec_name: string; width?: number; height?: number; nb_frames?: string; r_frame_rate?: string }[]
  format: { duration: string }
}

// Only an explicit operator-selected local deployment and approved renderers enable this integration case.
describe.skipIf(COMFY === undefined || FFMPEG === undefined || FFPROBE === undefined || webSnapshotMode() === 'record')(
  'real ComfyUI native diagnostic through the shipped Web project service', () => {
    let scaffold: WebScaffold
    let directory: string

    beforeAll(async () => {
      if (COMFY === undefined || FFMPEG === undefined || FFPROBE === undefined) throw new Error('Diagnostic endpoints are not configured.')
      const origin = new URL(COMFY)
      if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') throw new Error('This model-free test targets only operator-owned IPv4 loopback.')
      const response = await fetch(new URL('object_info', COMFY.endsWith('/') ? COMFY : COMFY + '/'))
      expect(response.status).toBe(200)
      const nodes = await response.json() as Record<string, NativeNode>
      expect(nodes.EmptyImage?.input.required.batch_size?.[0]).toBe('INT')
      expect(nodes.CreateVideo?.input.required.fps?.[0]).toBe('FLOAT')
      expect(nodes.SaveVideo?.output_node).toBe(true)
      expect(nodes.PrimitiveString?.input.required.value?.[0]).toBe('STRING')
      const workflow: ComfyWorkflow = {
        id: 'native-black-diagnostic', title: TITLE,
        template: {
          text: { class_type: 'PrimitiveString', inputs: { value: 'This diagnostic does not use a model or interpret the prompt.' } },
          frames: { class_type: 'EmptyImage', inputs: { width: 480, height: 480, batch_size: 8, color: 0 } },
          video: { class_type: 'CreateVideo', inputs: { images: ['frames', 0], fps: 8 } },
          save: { class_type: 'SaveVideo', inputs: {
            video: ['video', 0], filename_prefix: 'diagnostic', format: 'mp4', 'format.codec': 'h264',
          } },
        },
        prompt: { node: 'text', input: 'value' },
        duration: { node: 'frames', input: 'batch_size', unit: 'frames', fps: 8 },
        width: { node: 'frames', input: 'width' }, height: { node: 'frames', input: 'height' },
        references: [], outputPrefix: { node: 'save', input: 'filename_prefix' }, durations: [1],
        sizes: [{ aspectRatio: '1:1', resolution: '480p', width: 480, height: 480 }],
        output: { node: 'save', key: 'images', index: 0 },
      }
      directory = await mkdtemp(join(tmpdir(), 'dsh-comfy-real-e2e-'))
      const overlay = join(directory, 'native-diagnostic.patch.yml')
      await writeFile(overlay, JSON.stringify([
        { id: 'video-comfyui', config: { enabled: true, baseURL: COMFY, workflows: [workflow] } },
        { id: 'video-production', config: {
          ffmpegPath: FFMPEG, ffprobePath: FFPROBE, exportWidth: 480, exportHeight: 480, exportFrameRate: 24,
        } },
      ]))
      scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
      const fixture = (await readFile(await selectedSessionFixture(FIXTURE), 'utf8')).split('{{cwd}}').join(JSON.stringify(scaffold.workspaceCwd).slice(1, -1))
      await seedSession(scaffold, fixture, SESSION)
    })

    afterAll(async () => {
      try { await scaffold?.close() } finally {
        if (directory !== undefined) await rm(directory, { recursive: true, force: true, maxRetries: 3 })
      }
    })

    it('stores a genuine native black-frame version, then exports and reads a durable MP4', async () => {
      if (FFPROBE === undefined) throw new Error('The approved ffprobe path is required.')
      const targets = scaffold.ctx.videoProduction.generationTargets()
      const target = targets.find(item => item.generator === 'comfyui' && item.model === 'native-black-diagnostic')
      expect(target).toMatchObject({ title: TITLE, limits: { durations: [1], minReferenceImages: 0, maxReferenceImages: 0 } })
      expect(target?.revision).toMatch(/^[0-9a-f]{64}$/)
      const empty = await scaffold.ctx.videoProduction.view(SESSION)
      const shotId = 'native-black-shot' as VideoShotId
      await scaffold.ctx.videoProduction.update(SESSION, {
        revision: empty.revision, title: TITLE, assets: [], shots: [{
          id: shotId, title: TITLE, prompt: 'MODEL-FREE DIAGNOSTIC: do not interpret this text or load a model.',
          duration: 1, aspectRatio: '1:1', resolution: '480p', assetIds: [], position: { x: 0, y: 0 },
        }],
      })
      const generated = await scaffold.ctx.videoProduction.generate(
        SESSION, shotId, { generator: 'comfyui', model: 'native-black-diagnostic' }, new AbortController().signal,
      )
      const version = generated.shots[0]?.versions.at(-1)
      expect(version?.error).toBeUndefined()
      expect(version).toMatchObject({
        status: 'completed', generator: 'comfyui', generatorTitle: TITLE,
        generatorRevision: target?.revision, model: 'native-black-diagnostic',
      })
      if (version?.attachment === undefined) throw new Error('The native diagnostic did not return an admitted video.')
      const clip = await scaffold.ctx.attachments.readVideo(version.attachment)
      const exported = await scaffold.ctx.videoProduction.export(SESSION, new AbortController().signal)
      const film = exported.exports.at(-1)
      expect(film?.error).toBeUndefined()
      expect(film).toMatchObject({ status: 'completed', shotVersionIds: [version.id] })
      if (film?.attachment === undefined) throw new Error('The diagnostic film was not exported.')
      const stored = await scaffold.ctx.attachments.readVideo(film.attachment)
      const parts: Buffer[] = []
      for (let offset = 0; offset < film.attachment.bytes;) {
        const chunk = await scaffold.ctx.videoProduction.readMedia(SESSION, exported.id, film.attachment.attachmentId, offset, 65536)
        parts.push(Buffer.from(chunk.data, 'base64'))
        expect(chunk.nextOffset).toBeGreaterThan(offset)
        offset = chunk.nextOffset
      }
      expect(Buffer.concat(parts)).toEqual(Buffer.from(stored.data))
      expect((await scaffold.ctx.videoProduction.view(SESSION)).shots[0]?.versions[0]).toEqual(version)
      const evidence = join(REPO_ROOT, '.playwright-mcp')
      await mkdir(evidence, { recursive: true })
      const output = join(evidence, 'comfyui-project-native-diagnostic.mp4')
      await writeFile(output, stored.data)
      const probe = await execute(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { windowsHide: true })
      const metadata = JSON.parse(probe.stdout) as Probe
      expect(metadata.streams.find(stream => stream.codec_type === 'video')).toMatchObject({
        codec_name: 'h264', width: 480, height: 480, nb_frames: '24', r_frame_rate: '24/1',
      })
      expect(metadata.streams.some(stream => stream.codec_type === 'audio' && stream.codec_name === 'aac')).toBe(true)
      expect(Number(metadata.format.duration)).toBeGreaterThanOrEqual(1)
      expect(Number(metadata.format.duration)).toBeLessThan(1.2)
      await writeFile(join(evidence, 'comfyui-project-native-diagnostic.json'), JSON.stringify({
        kind: 'model-free-native-node-and-project-adapter-diagnostic', target, version,
        sourceSha256: createHash('sha256').update(clip.data).digest('hex'),
        filmSha256: createHash('sha256').update(stored.data).digest('hex'), film, probe: metadata,
      }, null, 2) + '\n')
    })
  },
)
