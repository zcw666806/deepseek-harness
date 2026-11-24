/** Host-local FFmpeg export through managed subprocess and attachment services. */
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-fs'
import type { ResolvedConfig } from './config.ts'
import { captionFilters, clipTrimFilters, resolveClipEdit, type VideoRenderClip } from './editing.ts'

async function run(
  subprocess: SubprocessRuntime,
  argv: readonly string[],
  cwd: string,
  config: ResolvedConfig,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  const handle = subprocess.spawn({
    argv, cwd, signal, graceMs: config.processGraceMs, env: { FFREPORT: undefined },
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: config.maxProcessOutputBytes },
      stderr: { maxBytes: config.maxProcessOutputBytes },
    },
  })
  try {
    const outcome = await handle.done
    signal.throwIfAborted()
    if (outcome.exitCode !== 0 || outcome.signal !== null) {
      throw new Error(`VIDEO_EXPORT_FAILED: ${handle.collected.stderr?.readFrom(0).text ?? 'renderer failed'}`)
    }
    return handle.collected.stdout?.readFrom(0).text ?? ''
  } finally {
    handle.terminate()
    await handle.waitForExit()
  }
}

function audioInProbe(text: string): boolean {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || !('streams' in parsed)
    || !Array.isArray(parsed.streams)) throw new Error('VIDEO_EXPORT_FAILED: invalid ffprobe stream report')
  return parsed.streams.some((stream: unknown) => typeof stream === 'object'
    && stream !== null && 'codec_type' in stream && stream.codec_type === 'audio')
}

function videoDuration(text: string): number {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || !('streams' in parsed)
    || !Array.isArray(parsed.streams)) throw new Error('VIDEO_EXPORT_FAILED: invalid normalized-video report')
  const stream: unknown = parsed.streams[0]
  const duration = typeof stream === 'object' && stream !== null && 'duration' in stream
    && typeof stream.duration === 'string' ? Number(stream.duration) : NaN
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('VIDEO_EXPORT_FAILED: normalized video has no positive duration')
  return duration
}

/**
 * Normalize the selected clips and concatenate them into one durable MP4.
 * Existing audio is retained; silent clips receive a matching silent track.
 * Temporary files remain host-local and are removed after the process tree exits.
 * @param ctx - context with attachment storage and optional local execution services.
 * @param clips - exact selected source attachments in film order.
 * @param config - resolved renderer executable, dimensions, and process bounds.
 * @param signal - complete-operation deadline and caller cancellation.
 * @returns the stored MP4 reference.
 */
export async function exportVideo(
  ctx: Context,
  clips: readonly VideoRenderClip[],
  config: ResolvedConfig,
  signal: AbortSignal,
): Promise<VideoAttachmentRef> {
  const subprocess = ctx.get('subprocess')
  const fs = ctx.get('fs')
  if (subprocess === undefined || fs === undefined) {
    throw new Error('VIDEO_EXPORT_UNAVAILABLE: host-local filesystem and subprocess services are required')
  }
  let ffmpeg: string
  let ffprobe: string
  try {
    ffmpeg = await subprocess.resolveExecutable(config.ffmpegPath, undefined, signal)
    ffprobe = await subprocess.resolveExecutable(config.ffprobePath, undefined, signal)
  } catch (error) {
    signal.throwIfAborted()
    throw new Error('VIDEO_EXPORT_UNAVAILABLE: install FFmpeg and configure ffmpegPath and ffprobePath', { cause: error })
  }
  const root = await mkdtemp(join(tmpdir(), 'dsh-video-export-'))
  try {
    const processRoot = fs.processPathFromHostPath(root)
    if (processRoot === undefined || resolve(processRoot) !== resolve(root)) {
      throw new Error('VIDEO_EXPORT_UNAVAILABLE: the execution provider cannot access host-local temporary files')
    }
    const normalized: string[] = []
    const hasFont = config.subtitleFontPath !== '' && clips.some(clip => (clip.edit?.captions?.length ?? 0) > 0)
    if (hasFont) await copyFile(config.subtitleFontPath, join(root, 'subtitle-font'))
    let bytes = 0
    for (const [index, clip] of clips.entries()) {
      const ref = clip.attachment
      const edit = resolveClipEdit(clip.edit)
      signal.throwIfAborted()
      bytes += ref.bytes
      if (bytes > config.maxExportBytes) throw new Error('VIDEO_EXPORT_TOO_LARGE: source clips exceed maxExportBytes')
      const stored = await ctx.attachments.readVideo(ref, signal)
      const input = join(root, `source-${index}.${ref.mediaType === 'video/mp4' ? 'mp4' : 'webm'}`)
      const picture = join(root, `picture-${index}.mp4`)
      const output = join(root, `clip-${index}.mp4`)
      await writeFile(input, stored.data, { flag: 'wx', mode: 0o600, signal })
      for (const [captionIndex, caption] of edit.captions.entries()) {
        await writeFile(join(root, `caption-${index}-${captionIndex}.txt`), caption.text, { flag: 'wx', mode: 0o600, signal })
      }
      const format = ref.mediaType === 'video/mp4' ? 'mov' : 'matroska'
      const localInput = ['-protocol_whitelist', 'file,pipe', '-f', format, '-i', input]
      const probe = await run(subprocess, [ffprobe, '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', ...localInput], root, config, signal)
      const hasAudio = audioInProbe(probe)
      await run(subprocess, [
        ffmpeg, '-nostdin', '-v', 'error', '-n', ...localInput,
        '-map', '0:v:0', '-an',
        '-vf', [...clipTrimFilters(edit, 'video'),
          `scale=${config.exportWidth}:${config.exportHeight}:force_original_aspect_ratio=decrease`,
          `pad=${config.exportWidth}:${config.exportHeight}:(ow-iw)/2:(oh-ih)/2`,
          'setsar=1', `fps=${config.exportFrameRate}`, ...captionFilters(edit.captions, index, hasFont)].join(','),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-fs', String(config.maxExportBytes), picture,
      ], root, config, signal)
      if ((await stat(picture)).size >= config.maxExportBytes) throw new Error('VIDEO_EXPORT_TOO_LARGE: normalized video reached maxExportBytes')
      const duration = videoDuration(await run(subprocess, [
        ffprobe, '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'json',
        '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', picture,
      ], root, config, signal))
      const audio = hasAudio ? localInput : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
      await run(subprocess, [
        ffmpeg, '-nostdin', '-v', 'error', '-n', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', picture, ...audio,
        '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
        '-af', [...(hasAudio ? clipTrimFilters(edit, 'audio') : ['asetpts=PTS-STARTPTS']),
          `volume=${edit.volume}`, 'apad'].join(','),
        '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-t', String(duration),
        '-fs', String(config.maxExportBytes), output,
      ], root, config, signal)
      if ((await stat(output)).size >= config.maxExportBytes) throw new Error('VIDEO_EXPORT_TOO_LARGE: normalized clip reached maxExportBytes')
      normalized.push(`file 'clip-${index}.mp4'`)
    }
    await writeFile(join(root, 'clips.txt'), normalized.join('\n') + '\n', { flag: 'wx', mode: 0o600, signal })
    const output = join(root, 'film.mp4')
    await run(subprocess, [
      ffmpeg, '-nostdin', '-v', 'error', '-n', '-protocol_whitelist', 'file,pipe', '-f', 'concat', '-safe', '1', '-i', join(root, 'clips.txt'),
      '-c', 'copy', '-movflags', '+faststart', '-fs', String(config.maxExportBytes), output,
    ], root, config, signal)
    const size = (await stat(output)).size
    if (size >= config.maxExportBytes) throw new Error('VIDEO_EXPORT_TOO_LARGE: rendered film reached maxExportBytes')
    const durationSeconds = videoDuration(await run(subprocess, [
      ffprobe, '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'json',
      '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', output,
    ], root, config, signal))
    const data = await readFile(output, { signal })
    return await ctx.attachments.saveVideo({
      data, mediaType: 'video/mp4', name: 'film.mp4',
      width: config.exportWidth, height: config.exportHeight, durationSeconds,
    }, signal)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
