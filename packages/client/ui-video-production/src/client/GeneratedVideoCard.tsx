/** Session-authorized preview for the existing generate_video tool result. */

import { useEffect, useRef, useState } from 'react'
import type { AttachmentId, VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionVideoAttachmentValue } from '@deepseek-ai/dsh-api-session-controller/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import css from './VideoProductionView.module.css'

/** Session-bound authorized media reader injected by this plugin. */
export interface GeneratedVideoFace {
  readonly readVideo: (id: AttachmentId, offset: number, length: number) => Promise<SessionVideoAttachmentValue>
}

/** Props of the generate_video keyed tool renderer. */
export type GeneratedVideoCardProps =
  PropsRuntime<'tool.call.toolview'> & PropsLocale<'videoProduction'> & GeneratedVideoFace

function videoReference(meta: unknown): VideoAttachmentRef | undefined {
  if (typeof meta !== 'object' || meta === null || !('type' in meta) || meta.type !== 'video' || !('attachment' in meta)) return
  const ref = meta.attachment
  if (typeof ref !== 'object' || ref === null || !('attachmentId' in ref) || typeof ref.attachmentId !== 'string'
    || ref.attachmentId.length === 0 || !('mediaType' in ref) || (ref.mediaType !== 'video/mp4' && ref.mediaType !== 'video/webm')
    || !('bytes' in ref) || typeof ref.bytes !== 'number' || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0) return
  return {
    attachmentId: ref.attachmentId as AttachmentId, mediaType: ref.mediaType, bytes: ref.bytes,
    ...'name' in ref && typeof ref.name === 'string' ? { name: ref.name } : {},
  }
}

interface Preview {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed'
  readonly url?: string
  readonly error?: string
}

interface PreviewOwner {
  active: boolean
  url?: string
}

function isActive(owner: PreviewOwner): boolean {
  return owner.active
}

/**
 * Render the original tool text plus an explicit, bounded video preview action.
 * @param props - persisted tool result, localized copy, and Session-authorized byte reader.
 * @returns a video card, or the ordinary result text when no valid video is available.
 */
export function GeneratedVideoCard(props: GeneratedVideoCardProps) {
  const { block, t } = props
  const result = 'kind' in block ? block : undefined
  const ref = result === undefined || result.isError ? undefined : videoReference(result.meta)
  const [preview, setPreview] = useState<Preview>({ status: 'idle' })
  const owner = useRef<PreviewOwner | null>(null)
  useEffect(() => {
    const current: PreviewOwner = { active: true }
    owner.current = current
    setPreview({ status: 'idle' })
    return () => {
      current.active = false
      if (current.url !== undefined) URL.revokeObjectURL(current.url)
    }
  }, [props.sessionId, ref?.attachmentId])

  const load = async (): Promise<void> => {
    const current = owner.current
    if (ref === undefined || current === null || !isActive(current) || preview.status === 'loading') return
    setPreview({ status: 'loading' })
    try {
      const parts: Uint8Array<ArrayBuffer>[] = []
      let offset = 0
      while (offset < ref.bytes) {
        const chunk = await props.readVideo(ref.attachmentId, offset, 256 * 1024)
        if (!isActive(current)) return
        const binary = atob(chunk.data)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
        if (chunk.offset !== offset || chunk.nextOffset !== offset + bytes.length
          || chunk.nextOffset <= offset || chunk.nextOffset > ref.bytes || chunk.total !== ref.bytes) {
          throw new Error('Video attachment returned inconsistent byte offsets.')
        }
        parts.push(bytes)
        offset = chunk.nextOffset
      }
      const url = URL.createObjectURL(new Blob(parts, { type: ref.mediaType }))
      current.url = url
      setPreview({ status: 'ready', url })
    } catch (error) {
      if (isActive(current)) setPreview({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const text = result?.content.flatMap(content => content.type === 'text' ? [content.text] : []).join('\n')
  return <section className={css.generatedCard}>
    <strong>{props.toolName}</strong>
    {text === undefined || text === ''
      ? <p>{t(result === undefined ? 'shot.generating' : result.isError ? 'operation.failed' : 'status.completed')}</p>
      : <pre>{text}</pre>}
    {ref === undefined ? null : preview.url === undefined
      ? <button type="button" disabled={preview.status === 'loading'} onClick={() => { void load() }}>
        {t(preview.status === 'loading' ? 'media.loading' : 'media.load')}
      </button>
      : <div className={css.media}>
        <video controls preload="metadata" src={preview.url} aria-label={t('media.preview')} />
        <a href={preview.url} download={ref.name ?? `${ref.attachmentId}.${ref.mediaType === 'video/webm' ? 'webm' : 'mp4'}`}>{t('shot.download')}</a>
      </div>}
    {preview.error === undefined ? null : <p className={css.error} role="alert">{t('media.failed')}: {preview.error}</p>}
  </section>
}
