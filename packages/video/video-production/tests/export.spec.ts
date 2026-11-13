import { readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { VideoShotId } from '../src/index.ts'
import { projectInput, setup, signal, video } from './helpers.ts'

const fixtures: Awaited<ReturnType<typeof setup>>[] = []
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.dispose() })

class RecordingRenderer extends SubprocessRuntime {
  readonly specs: SubprocessSpawnSpec[] = []
  readonly terminated: number[] = []
  readonly captionText: string[] = []
  missing = false
  fail = false
  invalidDuration = false
  private probes = 0

  async resolveExecutable(command: string): Promise<string> {
    if (this.missing) throw new Error('Executable not found')
    return command
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    const index = this.specs.length
    const probe = spec.argv[0] === 'ffprobe'
    const text = !probe ? '' : spec.argv.includes('-select_streams')
      ? JSON.stringify({ streams: [{ duration: this.invalidDuration ? 'N/A' : '1.25' }] })
      : JSON.stringify({ streams: this.probes++ === 0 ? [{ codec_type: 'video' }, { codec_type: 'audio' }] : [{ codec_type: 'video' }] })
    const done = (async () => {
      spec.signal?.throwIfAborted()
      if (spec.argv.includes('-vf')) {
        const filters = spec.argv[spec.argv.indexOf('-vf') + 1]!
        for (const file of filters.matchAll(/textfile=(caption-\d+-\d+\.txt)/g)) {
          this.captionText.push(await readFile(join(spec.cwd, file[1]!), 'utf8'))
        }
      }
      if (!probe && !this.fail) {
        await writeFile(spec.argv.at(-1)!, Buffer.from([0, 0, 0, 20, 102, 116, 121, 112, 109, 112, 52, 50]))
      }
      return { exitCode: this.fail ? 2 : 0, signal: null }
    })()
    return {
      pid: index, stdin: undefined, stdout: undefined, stderr: undefined, done,
      collected: {
        stdout: { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) },
        stderr: { readFrom: () => ({ text: 'renderer diagnostic', nextOffset: 19, lossy: false }) },
      },
      terminate: () => { this.terminated.push(index) },
      waitForExit: async () => { await done; return true },
    }
  }

  spawnTerminal(): Promise<SubprocessTerminalHandle> { return Promise.reject(new Error('No terminal in renderer fixture')) }
}

async function fixture() {
  const value = await setup()
  fixtures.push(value)
  const { ctx, sessionId } = value
  // Record the external renderer protocol without starting an OS process.
  ctx.provide('fs', { processPathFromHostPath: (path: string) => path } as FileSystem)
  await ctx.plugin(RecordingRenderer)
  await ctx.videoProduction.update(sessionId, projectInput())
  ctx.videoProduction.registerGenerator('recorded', async request => ({ attachment: await video(ctx, request.prompt.length) }))
  await ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
  await ctx.videoProduction.generate(sessionId, VideoShotId('second'), {}, signal())
  return { ...value, renderer: ctx.subprocess as RecordingRenderer }
}

describe('host-local video film export', () => {
  it('keeps shot order, pads short audio, supplies silence, and cleans all temporary files after settlement', async () => {
    const { ctx, sessionId, renderer } = await fixture()
    const project = await ctx.videoProduction.export(sessionId, signal())
    expect(project.exports[0]?.status).toBe('completed')
    expect(project.exports[0]?.shotVersionIds).toEqual(project.shots.map(shot => shot.selectedVersionId))
    const normalize = renderer.specs.filter(spec => spec.argv.includes('-vf'))
    expect(normalize).toHaveLength(2)
    expect(normalize[0]?.argv[normalize[0].argv.indexOf('-vf') + 1]).toContain(',fps=24')
    expect(normalize[0]?.argv).not.toContain('-r')
    const audio = renderer.specs.filter(spec => spec.argv.includes('-af'))
    expect(audio).toHaveLength(2)
    expect(audio[0]?.argv).toEqual(expect.arrayContaining(['-map', '1:a:0', '-af',
      'asetpts=PTS-STARTPTS,atrim=start=0,asetpts=PTS-STARTPTS,volume=1,apad', '-t', '1.25', '-c:v', 'copy']))
    expect(audio[0]?.argv).not.toContain('-shortest')
    expect(audio[1]?.argv).toEqual(expect.arrayContaining(['anullsrc=r=48000:cl=stereo', '1:a:0']))
    const concat = renderer.specs.find(spec => spec.argv.includes('concat'))!
    expect(concat.argv).toEqual(expect.arrayContaining(['concat', '-safe', '1', '-c', 'copy']))
    for (const spec of renderer.specs) {
      expect(spec.env).toEqual({ FFREPORT: undefined })
      expect(spec.argv).toEqual(expect.arrayContaining(['-protocol_whitelist', 'file,pipe']))
    }
    expect(normalize[0]?.argv).toEqual(expect.arrayContaining(['-f', 'mov']))
    expect(renderer.terminated).toHaveLength(renderer.specs.length)
    await expect(stat(concat.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
    const ref = project.exports[0]!.attachment!
    expect((await ctx.attachments.readVideo(ref)).data.byteLength).toBe(ref.bytes)
  })

  it('trims picture and original audio together and treats caption text as literal file content', async () => {
    const { ctx, sessionId, renderer } = await fixture()
    const current = await ctx.videoProduction.view(sessionId)
    const text = '%{localtime} 中文 [movie=private] \\ {override}\nSecond line'
    const edit = { trimStartSeconds: 0.25, trimEndSeconds: 1, volume: 0.5,
      captions: [{ startSeconds: 0.1, endSeconds: 0.6, text }] }
    await ctx.videoProduction.update(sessionId, { revision: current.revision, title: current.title, assets: current.assets,
      shots: current.shots.map(({ versions: _versions, ...shot }, index) => ({ ...shot, ...index === 0 ? { edit } : {} })),
    })
    const project = await ctx.videoProduction.export(sessionId, signal())
    expect(project.exports.at(-1)).toMatchObject({ status: 'completed', clipEdits: [edit, null] })
    const picture = renderer.specs.find(spec => spec.argv.includes('-vf'))!
    const filters = picture.argv[picture.argv.indexOf('-vf') + 1]!
    expect(filters).toContain('trim=start=0.25:end=1,setpts=PTS-STARTPTS')
    expect(filters).toContain('textfile=caption-0-0.txt:expansion=none')
    expect(filters).not.toContain(text)
    expect(renderer.captionText).toEqual([text])
    const audio = renderer.specs.find(spec => spec.argv.includes('-af'))!
    expect(audio.argv[audio.argv.indexOf('-af') + 1]).toContain('atrim=start=0.25:end=1,asetpts=PTS-STARTPTS,volume=0.5,apad')
    await expect(stat(picture.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects reversed trim ranges and invalid caption timing before mutating the project', async () => {
    const { ctx, sessionId } = await fixture()
    const current = await ctx.videoProduction.view(sessionId)
    for (const edit of [
      { trimStartSeconds: 1, trimEndSeconds: 0.5 },
      { captions: [{ startSeconds: 1, endSeconds: 1, text: 'caption' }] },
      { captions: [{ startSeconds: 0, endSeconds: 1, text: 'bad\u0000text' }] },
    ]) {
      await expect(ctx.videoProduction.update(sessionId, { revision: current.revision, title: current.title, assets: current.assets,
        shots: current.shots.map(({ versions: _versions, ...shot }) => ({ ...shot, edit })),
      })).rejects.toThrow()
    }
    expect(await ctx.videoProduction.view(sessionId)).toEqual(current)
  })

  it('retains renderer diagnostics and removes temporary work after a process failure', async () => {
    const { ctx, sessionId, renderer } = await fixture()
    renderer.fail = true
    const project = await ctx.videoProduction.export(sessionId, signal())
    expect(project.exports[0]?.status).toBe('failed')
    expect(project.exports[0]?.error).toContain('renderer diagnostic')
    expect(renderer.terminated).toHaveLength(renderer.specs.length)
    await expect(stat(renderer.specs[0]!.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an unmeasurable encoded video before adding an unbounded padded audio track', async () => {
    const { ctx, sessionId, renderer } = await fixture()
    renderer.invalidDuration = true
    const project = await ctx.videoProduction.export(sessionId, signal())
    expect(project.exports[0]?.status).toBe('failed')
    expect(project.exports[0]?.error).toContain('no positive duration')
    expect(renderer.specs.some(spec => spec.argv.includes('-af'))).toBe(false)
    await expect(stat(renderer.specs[0]!.cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports a missing executable without spawning or installing a process', async () => {
    const { ctx, sessionId, renderer } = await fixture()
    renderer.missing = true
    const project = await ctx.videoProduction.export(sessionId, signal())
    expect(project.exports[0]?.status).toBe('failed')
    expect(project.exports[0]?.error).toContain('configure ffmpegPath and ffprobePath')
    expect(renderer.specs).toEqual([])
  })
})
