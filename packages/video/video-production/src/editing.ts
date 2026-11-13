/** Non-destructive film editing resolved to literal renderer input files and numeric filters. */
import type { VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { VideoCaption, VideoClipEdit } from './types.ts'

/** Selected source with independent editing values captured by an export attempt. */
export interface VideoRenderClip {
  readonly attachment: VideoAttachmentRef
  readonly edit?: VideoClipEdit | undefined
}

/** Complete renderer editing values; source-end omission retains the complete remaining video. */
export interface ResolvedClipEdit {
  readonly trimStartSeconds: number
  readonly trimEndSeconds?: number
  readonly volume: number
  readonly captions: readonly VideoCaption[]
}

/**
 * Resolve admitted editing defaults before constructing renderer arguments.
 * @param edit - Optional non-destructive project editing values.
 * @returns Complete numeric trim, volume and literal-caption selections.
 */
export function resolveClipEdit(edit: VideoClipEdit | undefined): ResolvedClipEdit {
  return { trimStartSeconds: edit?.trimStartSeconds ?? 0, volume: edit?.volume ?? 1, captions: edit?.captions ?? [],
    ...edit?.trimEndSeconds === undefined ? {} : { trimEndSeconds: edit.trimEndSeconds } }
}

/**
 * Build a trim filter from admitted numbers, with timestamps relative to the source's first frame.
 * @param edit - Resolved editing values.
 * @param kind - Video or audio filter prefix.
 * @returns Timestamp reset and trim filters; no user text or host path is included.
 */
export function clipTrimFilters(edit: ResolvedClipEdit, kind: 'video' | 'audio'): string[] {
  const reset = kind === 'video' ? 'setpts=PTS-STARTPTS' : 'asetpts=PTS-STARTPTS'
  const trim = kind === 'video' ? 'trim' : 'atrim'
  return [reset, `${trim}=start=${edit.trimStartSeconds}${edit.trimEndSeconds === undefined ? '' : `:end=${edit.trimEndSeconds}`}`, reset]
}

/**
 * Render literal UTF-8 caption files with expression expansion disabled.
 * @param captions - Admitted timing records relative to the trimmed clip.
 * @param clipIndex - Private output-file identity assigned by the renderer.
 * @param hasFont - Whether the renderer copied an operator-configured font into its private directory.
 * @returns Filters containing only private basenames and admitted numeric timing values.
 */
export function captionFilters(captions: readonly VideoCaption[], clipIndex: number, hasFont: boolean): string[] {
  return captions.map((caption, index) =>
    `drawtext=textfile=caption-${clipIndex}-${index}.txt:expansion=none${hasFont ? ':fontfile=subtitle-font' : ''}`
    + `:fontcolor=white:fontsize=h/24:borderw=2:bordercolor=black:x=(w-tw)/2:y=h-th-h/12:enable='gte(t,${caption.startSeconds})*lt(t,${caption.endSeconds})'`)
}
