// Real FFmpeg composition over synthetic local clips; no provider API calls or generated-character claims.
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { VideoShotId } from '@deepseek-ai/dsh-video-production/types'
import type {} from '@deepseek-ai/dsh-video-production'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { openCreationStudio, REPO_ROOT, ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const execute = promisify(execFile)
const FFMPEG = process.env.DSH_TEST_FFMPEG_PATH
const FFPROBE = process.env.DSH_TEST_FFPROBE_PATH
const SUBTITLE_FONT = process.env.DSH_TEST_SUBTITLE_FONT_PATH
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.jsonl', import.meta.url))
const SESSION = SessionId('video-film-export-web-e2e')

interface Probe {
  streams: {
    codec_type: string
    codec_name: string
    width?: number
    height?: number
    duration?: string
    r_frame_rate?: string
    nb_frames?: string
  }[]
  format: { duration: string; format_name: string }
}

async function probe(path: string): Promise<Probe> {
  if (FFPROBE === undefined) throw new Error('The real-export fixture requires DSH_TEST_FFPROBE_PATH.')
  const result = await execute(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { windowsHide: true })
  return JSON.parse(result.stdout) as Probe
}

function poll<Value>(read: () => Value | Promise<Value>) { return expect.poll(read, { timeout: 30_000 }) }

// Explicit opt-in runs only the operator-selected binaries; ordinary Web CI needs no renderer installation.
describe.skipIf(FFMPEG === undefined || FFPROBE === undefined || webSnapshotMode() === 'record')('web e2e: real film export', () => {
  let root: string
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let exportExecutable: string
  let clips: VideoAttachmentRef[]
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    if (FFMPEG === undefined || FFPROBE === undefined) throw new Error('Set the approved FFmpeg and ffprobe fixture paths.')
    root = await mkdtemp(join(tmpdir(), 'dsh-film-e2e-'))
    const first = join(root, 'synthetic-short-audio.mp4')
    const second = join(root, 'synthetic-silent.mp4')
    const third = join(root, 'synthetic-long-audio.mp4')
    await execute(FFMPEG, [
      '-nostdin', '-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=12:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.25',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '1',
      '-metadata', 'comment=Synthetic export regression fixture', first,
    ], { windowsHide: true })
    await execute(FFMPEG, [
      '-nostdin', '-v', 'error', '-n', '-f', 'lavfi', '-i', 'color=c=teal:s=640x360:r=15:d=1.2',
      '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-metadata', 'comment=Synthetic export regression fixture', second,
    ], { windowsHide: true })
    await execute(FFMPEG, [
      '-nostdin', '-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=480x270:rate=30:duration=0.5',
      '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=1.5',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      '-metadata', 'comment=Synthetic long-audio regression fixture', third,
    ], { windowsHide: true })
    const thirdProbe = await probe(third)
    expect(Number(thirdProbe.streams.find(stream => stream.codec_type === 'video')?.duration)).toBe(0.5)
    expect(Number(thirdProbe.streams.find(stream => stream.codec_type === 'audio')?.duration)).toBeGreaterThanOrEqual(1.5)
    const firstProbe = await probe(first)
    const secondProbe = await probe(second)
    expect(firstProbe.streams.find(stream => stream.codec_type === 'video')).toMatchObject({ width: 320, height: 240 })
    expect(Number(firstProbe.streams.find(stream => stream.codec_type === 'audio')?.duration)).toBeLessThan(0.5)
    expect(secondProbe.streams.find(stream => stream.codec_type === 'video')).toMatchObject({ width: 640, height: 360 })
    expect(secondProbe.streams.some(stream => stream.codec_type === 'audio')).toBe(false)
    // The private byte-identical copy can disappear during the failure test without touching the installed renderer.
    exportExecutable = join(root, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    await copyFile(FFMPEG, exportExecutable)
    const overlay = join(root, 'export.patch.yml')
    await writeFile(overlay, JSON.stringify([{ id: 'video-production', config: {
      ffmpegPath: exportExecutable, ffprobePath: FFPROBE, exportWidth: 640, exportHeight: 360, exportFrameRate: 24,
      ...SUBTITLE_FONT === undefined ? {} : { subtitleFontPath: SUBTITLE_FONT },
    } }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
    const session = (await readFile(FIXTURE, 'utf8')).split('{{cwd}}').join(JSON.stringify(scaffold.workspaceCwd).slice(1, -1))
    await seedSession(scaffold, session, SESSION)
    await scaffold.ctx.sessionController.rename({ sessionId: SESSION, title: '真实成片导出 · 合成测试素材' })
    clips = await Promise.all([first, second, third].map(async (path, index) => scaffold.ctx.attachments.saveVideo({
      data: await readFile(path), mediaType: 'video/mp4', name: `synthetic-clip-${index + 1}.mp4`,
    })))
    scaffold.ctx.videoProduction.registerGenerator('film-export-fixture', async (request, signal) => {
      signal.throwIfAborted()
      const attachment = clips[request.prompt === 'Synthetic short-audio clip' ? 0 : request.prompt === 'Synthetic silent clip' ? 1 : 2]
      if (attachment === undefined) throw new Error('Synthetic clip was not admitted.')
      return { attachment, model: 'synthetic-ffmpeg-fixture' }
    })
    const empty = await scaffold.ctx.videoProduction.view(SESSION)
    const prepared = await scaffold.ctx.videoProduction.update(SESSION, {
      revision: empty.revision, title: '成片合成验证 · 免费测试片段', assets: [],
      shots: ['Synthetic short-audio clip', 'Synthetic silent clip', 'Synthetic long-audio clip'].map((prompt, index) => ({
        id: `film-shot-${index}` as VideoShotId, title: index === 0 ? '01 · 短音轨测试片段' : index === 1 ? '02 · 无声测试片段' : '03 · 长音轨测试片段',
        prompt, duration: 1, aspectRatio: index === 0 ? '1:1' : '16:9', resolution: '480p', assetIds: [], position: { x: 0, y: 0 },
      })),
    })
    for (const shot of prepared.shots) await scaffold.ctx.videoProduction.generate(
      SESSION, shot.id, { generator: 'film-export-fixture' }, new AbortController().signal,
    )
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1920, height: 1120 }, locale: ZH_BROWSER_LOCALE, colorScheme: 'dark' })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('treeitem').first().click()
    await page.getByRole('treeitem').nth(1).click()
    await openCreationStudio(page, 'video', 'zh')
    await page.getByLabel('项目名称', { exact: true }).waitFor()
  })

  afterAll(async () => {
    try { await browser?.close() } finally {
      try { await scaffold?.close() } finally { if (root !== undefined) await rm(root, { recursive: true, force: true, maxRetries: 3 }) }
    }
  })

  it('exports real selected clips, plays and downloads the MP4, then retains the old film after a missing-renderer failure', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-film-export'))
    await page.getByRole('button', { name: '合成导出', exact: true }).click()
    await poll(async () => (await scaffold.ctx.videoProduction.view(SESSION)).exports.at(-1)?.status).toBe('completed')
    const project = await scaffold.ctx.videoProduction.view(SESSION)
    const completed = project.exports.at(-1)
    if (completed?.attachment === undefined) throw new Error(`Real export failed: ${completed?.error ?? 'no MP4 attachment'}`)
    expect(completed.shotVersionIds).toEqual(project.shots.map(shot => shot.selectedVersionId))
    expect(completed.attachment.mediaType).toBe('video/mp4')
    const film = page.locator('[data-workflow-kind="film"]')
    await page.getByRole('button', { name: '适应画布', exact: true }).click()
    await film.getByRole('button', { name: '加载视频', exact: true }).click()
    const video = film.getByLabel('预览成片', { exact: true })
    await poll(() => video.evaluate(element => ({
      ready: (element as HTMLVideoElement).readyState >= 2, width: (element as HTMLVideoElement).videoWidth,
      height: (element as HTMLVideoElement).videoHeight, controls: (element as HTMLVideoElement).controls,
    }))).toEqual({ ready: true, width: 640, height: 360, controls: true })
    await video.evaluate(async (element) => {
      const player = element as HTMLVideoElement
      player.muted = true
      await player.play()
    })
    await poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.25)
    await video.evaluate((element) => { (element as HTMLVideoElement).pause() })
    const [download] = await Promise.all([
      page.waitForEvent('download'), film.getByRole('link', { name: '下载成片', exact: true }).click(),
    ])
    expect(download.suggestedFilename()).toBe('film.mp4')
    const path = await download.path()
    if (path === null) throw new Error('The real film did not download.')
    const stored = await scaffold.ctx.attachments.readVideo(completed.attachment)
    expect(await readFile(path)).toEqual(Buffer.from(stored.data))
    const result = await probe(path)
    const evidence = join(REPO_ROOT, '.playwright-mcp')
    await mkdir(evidence, { recursive: true })
    await copyFile(path, join(evidence, 'video-production-real-film.mp4'))
    await writeFile(join(evidence, 'video-production-real-film-probe.json'), JSON.stringify(result, null, 2) + '\n')
    expect(result.streams.find(stream => stream.codec_type === 'video')).toMatchObject({
      codec_name: 'h264', width: 640, height: 360, r_frame_rate: '24/1', nb_frames: '65',
    })
    expect(result.streams.find(stream => stream.codec_type === 'audio')?.codec_name).toBe('aac')
    expect(Number(result.format.duration)).toBeGreaterThanOrEqual(2.5)
    expect(Number(result.format.duration)).toBeLessThan(2.9)
    await page.screenshot({ path: join(evidence, 'video-production-real-film.png'), fullPage: true })
    await page.getByLabel('搜索节点…', { exact: true }).fill('最终成片')
    await poll(async () => (await film.boundingBox())?.width ?? 0).toBeGreaterThan(260)
    await film.screenshot({ path: join(evidence, 'video-production-real-film-detail.png') })
    await page.getByLabel('搜索节点…', { exact: true }).fill('')
    await page.getByRole('button', { name: /01 · 短音轨测试片段/ }).last().click()
    await page.getByLabel('裁切起点（秒）', { exact: true }).fill('0.25')
    await page.getByLabel('裁切终点（秒）', { exact: true }).fill('0.75')
    await page.getByLabel('原声音量（0 为静音，1 为原音量）', { exact: true }).fill('0')
    await page.getByRole('button', { name: '添加字幕', exact: true }).click()
    await page.getByLabel('字幕 1 文本', { exact: true }).fill('DSH 字幕剪辑验收')
    await page.getByLabel('字幕 1 结束（秒）', { exact: true }).fill('0.4')
    await page.getByRole('button', { name: '保存分镜', exact: true }).click()
    await poll(async () => (await scaffold.ctx.videoProduction.view(SESSION)).shots[0]?.edit?.volume).toBe(0)
    await page.getByRole('button', { name: '合成导出', exact: true }).click()
    await poll(async () => (await scaffold.ctx.videoProduction.view(SESSION)).exports.at(-1)?.status).toBe('completed')
    const edited = await scaffold.ctx.videoProduction.view(SESSION)
    const editedFilm = edited.exports.at(-1)
    if (editedFilm?.attachment === undefined) throw new Error(`Clip editing failed: ${editedFilm?.error ?? 'no MP4'}`)
    expect(edited.shots.map(shot => shot.versions)).toEqual(project.shots.map(shot => shot.versions))
    expect(editedFilm.clipEdits?.[0]).toMatchObject({ trimStartSeconds: 0.25, trimEndSeconds: 0.75, volume: 0 })
    await film.getByRole('button', { name: '加载视频', exact: true }).click()
    await poll(() => film.getByLabel('预览成片', { exact: true }).evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
    const editedBytes = (await scaffold.ctx.attachments.readVideo(editedFilm.attachment)).data
    const editedPath = join(evidence, 'video-editing-real-film.mp4')
    await writeFile(editedPath, editedBytes)
    const editedProbe = await probe(editedPath)
    expect(editedProbe.streams.find(stream => stream.codec_type === 'video')).toMatchObject({
      codec_name: 'h264', width: 640, height: 360, r_frame_rate: '24/1', nb_frames: '53',
    })
    expect(editedProbe.streams.find(stream => stream.codec_type === 'audio')?.codec_name).toBe('aac')
    expect(Number(editedProbe.format.duration)).toBeGreaterThan(2.1)
    expect(Number(editedProbe.format.duration)).toBeLessThan(2.4)
    await writeFile(join(evidence, 'video-editing-real-probe.json'), JSON.stringify(editedProbe, null, 2) + '\n')
    await execute(FFMPEG!, ['-nostdin', '-v', 'error', '-y', '-ss', '0.2', '-i', editedPath,
      '-frames:v', '1', join(evidence, 'video-editing-caption-frame.png')], { windowsHide: true })
    await page.screenshot({ path: join(evidence, 'video-editing-real.png'), fullPage: true })
    await unlink(exportExecutable)
    await page.getByRole('button', { name: '合成导出', exact: true }).click()
    await poll(async () => (await scaffold.ctx.videoProduction.view(SESSION)).exports.at(-1)?.status).toBe('failed')
    await poll(() => page.getByRole('alert').allTextContents()).toContainEqual(expect.stringContaining('VIDEO_EXPORT_UNAVAILABLE'))
    const afterFailure = await scaffold.ctx.videoProduction.view(SESSION)
    expect(afterFailure.exports).toHaveLength(3)
    expect(afterFailure.exports[0]?.attachment).toEqual(completed.attachment)
    expect(afterFailure.exports[1]?.attachment).toEqual(editedFilm.attachment)
    expect(afterFailure.exports[2]?.attachment).toBeUndefined()
    expect(await film.getByRole('link', { name: '下载成片', exact: true }).getAttribute('download')).toBe('film.mp4')
    await film.getByText('最近合成：合成失败', { exact: true }).waitFor()
    expect(await film.getByText('上次成功的成片', { exact: true }).count()).toBe(1)
    expect(await film.getByText('最近合成：已完成', { exact: true }).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    await page.screenshot({ path: join(evidence, 'video-production-export-failure.png'), fullPage: true })
  })
})
