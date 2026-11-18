/** Generate or import a finalized four-panel reply in its current Workspace. */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { readStoryboard, storyboardPackage } from '@deepseek-ai/dsh-comic-production/storyboard'
import type { ComicDraft, ComicProject, ComicProjectId, ComicProjectPackage } from '@deepseek-ai/dsh-comic-production/types'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComicWorkbenchApi } from './ComicWorkbench.tsx'
import { NS, type ComicProductionKey } from './locales.ts'
import { canvasPng, drawComicPage, pageArtwork, renderArtwork } from './renderer.ts'
import css from './ComicWorkbench.module.css'

/** Session-bound availability, project persistence, and artwork commands. */
export interface StoryboardActionApi extends Pick<ComicWorkbenchApi, 'readImage'> {
  readonly openEditor: (projectId: ComicProjectId) => void
  readonly generationAvailable: (signal: AbortSignal) => Promise<boolean>
  readonly result: (messageId: string, signal: AbortSignal) => Promise<ComicProject | undefined>
  readonly generate: (messageId: string, draft: ComicDraft, artDirection: string) => Promise<ComicProject>
  readonly importProject: (project: ComicProjectPackage, signal: AbortSignal) => Promise<ComicProject>
}

/** Model changes that require existing storyboard cards to refresh availability. */
export interface StoryboardActionInjected {
  readonly api: StoryboardActionApi
  readonly hooks: {
    readonly generationChanges: HostObservable<{ readonly sessionId: SessionId } | null>
  }
}

type StoryboardActionProps = PropsRuntime<'conversation.chat.assistant-follow-up'> & PropsLocale<typeof NS> & InjectFace<StoryboardActionInjected>

type Lookup =
  | { readonly kind: 'checking' }
  | { readonly kind: 'failed'; readonly failure: ComicProductionKey }
  | { readonly kind: 'ready'; readonly available: boolean; readonly project?: ComicProject; readonly failure?: ComicProductionKey }

type Preview =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly url: string }

function generationFailure(error: unknown, fallback: ComicProductionKey = 'storyboard.generationFailed'): ComicProductionKey {
  const details = typeof error === 'object' && error !== null && 'details' in error ? error.details : undefined
  const reason = typeof details === 'object' && details !== null && 'reason' in details ? details.reason : undefined
  switch (reason) {
    case 'generation-unavailable': return 'storyboard.unavailable'
    case 'generation-unknown':
    case 'generation-timeout': return 'storyboard.generationUnknown'
    case 'generation-request':
    case 'generation-response':
    case 'storyboard-invalid': return 'storyboard.generationFailed'
    default: return fallback
  }
}

function StoryboardResult({ project, readImage, openEditor, t }: {
  readonly project: ComicProject
  readonly readImage: StoryboardActionApi['readImage']
  readonly openEditor: () => void
  readonly t: StoryboardActionProps['t']
}) {
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined
    const render = async () => {
      const page = project.pages[0]
      if (page === undefined) throw new Error('The saved comic has no page.')
      await document.fonts.ready
      controller.signal.throwIfAborted()
      const artwork = await renderArtwork(pageArtwork(page), image => readImage(project.id, image, controller.signal), controller.signal)
      const target = document.createElement('canvas')
      try {
        controller.signal.throwIfAborted()
        drawComicPage(target, page, artwork)
        const png = await canvasPng(target)
        controller.signal.throwIfAborted()
        url = URL.createObjectURL(png)
        setPreview({ kind: 'ready', url })
      } finally {
        artwork.width = 0
        target.width = 0
      }
    }
    setPreview({ kind: 'loading' })
    void render().catch((_error: unknown) => {
      if (!controller.signal.aborted) setPreview({ kind: 'failed' })
    })
    return () => {
      controller.abort()
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [project, readImage, retry])
  return (
    <div className={css.storyboardResult} data-comic-storyboard-result="">
      {preview.kind === 'loading' && <p role="status">{t('storyboard.previewLoading')}</p>}
      {preview.kind === 'failed' && <p role="alert">{t('storyboard.previewFailed')}</p>}
      {preview.kind === 'ready' && <img src={preview.url} alt={t('storyboard.resultAlt')} />}
      <div className={css.storyboardAction}>
        {preview.kind === 'ready' && (
          <a href={preview.url} download={`${project.title.replace(/[<>:"/\\|?*]/gu, '-')}.png`}>
            {t('storyboard.download')}
          </a>
        )}
        <button type="button" onClick={openEditor}>{t('storyboard.openEditor')}</button>
        {preview.kind === 'failed' && (
          <button type="button" onClick={() => { setRetry(value => value + 1) }}>{t('storyboard.retryPreview')}</button>
        )}
      </div>
    </div>
  )
}

/**
 * Offer available next steps for a settled reply with four complete storyboard panels.
 * @param props - Settled reply identity and text, Session navigation, and project commands.
 * @returns Generation, import, or the saved image under the source reply.
 */
export function StoryboardAction({ messageId, text, openView, api, t, sessionId, useGenerationChanges }: StoryboardActionProps) {
  const storyboard = useMemo(() => readStoryboard(text), [text])
  const eligible = storyboard !== null && openView !== undefined
  const active = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState<'generate' | 'import' | null>(null)
  const [failure, setFailure] = useState<ComicProductionKey | null>(null)
  const [lookup, setLookup] = useState<Lookup>({ kind: 'checking' })
  const [retry, setRetry] = useState(0)
  const generationChange = useGenerationChanges(change => change?.sessionId === sessionId ? change : null)
  useEffect(() => () => { active.current?.abort() }, [])
  useEffect(() => {
    if (generationChange !== null) {
      setFailure(current => current === 'storyboard.unavailable' ? null : current)
    }
  }, [generationChange])
  useEffect(() => {
    if (!eligible) return
    const controller = new AbortController()
    const updateLookup = (replacement: Lookup) => {
      setLookup(current => current.kind === 'ready' && current.project !== undefined ? current : replacement)
    }
    updateLookup({ kind: 'checking' })
    void Promise.allSettled([
      api.result(messageId, controller.signal),
      api.generationAvailable(controller.signal),
    ]).then(([result, availability]) => {
      if (controller.signal.aborted) return
      const project = result.status === 'fulfilled' ? result.value : undefined
      if (project !== undefined) {
        updateLookup({ kind: 'ready', project, available: availability.status === 'fulfilled' && availability.value })
        return
      }
      const failure = result.status === 'rejected' ? generationFailure(result.reason, 'storyboard.lookupFailed') : undefined
      if (failure === 'storyboard.lookupFailed' || availability.status === 'rejected') {
        updateLookup({ kind: 'failed', failure: failure ?? 'storyboard.lookupFailed' })
        return
      }
      updateLookup({ kind: 'ready', available: availability.value, ...(failure === undefined ? {} : { failure }) })
    })
    return () => { controller.abort() }
  }, [api, eligible, messageId, retry, generationChange])
  if (storyboard === null || openView === undefined) return null

  const project = lookup.kind === 'ready' ? lookup.project : undefined
  if (project !== undefined) {
    return <StoryboardResult project={project} readImage={api.readImage} t={t}
      openEditor={() => { api.openEditor(project.id) }} />
  }

  const diagnostic = failure ?? (lookup.kind === 'checking' ? undefined : lookup.failure)
  const needsRecheck = diagnostic === 'storyboard.generationUnknown' || diagnostic === 'storyboard.unavailable'
  const canGenerate = lookup.kind === 'ready' && lookup.available && !needsRecheck
  const run = async (action: 'generate' | 'import') => {
    if (active.current !== null || (action === 'generate' && !canGenerate)) return
    const controller = new AbortController()
    active.current = controller
    setBusy(action)
    setFailure(null)
    try {
      const data = storyboardPackage(storyboard, t('storyboard.defaultTitle'), t('layer.default'), action === 'generate' ? 520 : 720)
      if (action === 'generate') {
        // The Host owns the generation after the user starts it, including when this View closes.
        const generated = await api.generate(messageId, data.draft, storyboard.artDirection)
        if (!controller.signal.aborted) setLookup({ kind: 'ready', project: generated, available: true })
      } else {
        const imported = await api.importProject(data, controller.signal)
        if (!controller.signal.aborted) api.openEditor(imported.id)
      }
    } catch (error) {
      if (!controller.signal.aborted) setFailure(action === 'generate' ? generationFailure(error) : 'storyboard.failed')
    } finally {
      active.current = null
      if (!controller.signal.aborted) setBusy(null)
    }
  }
  const unavailable = lookup.kind === 'ready' && !lookup.available
  const canRefresh = lookup.kind === 'failed' || unavailable || needsRecheck
  return (
    <div className={css.storyboardResult}>
      <div className={css.storyboardAction}>
        <button className={css.storyboardPrimary} type="button" disabled={busy !== null || !canGenerate}
          onClick={() => { void run('generate') }}>
          {busy === 'generate' ? t('storyboard.generating') : t(
            diagnostic === 'storyboard.generationFailed' ? 'storyboard.retryGenerate' : 'storyboard.generate',
          )}
        </button>
        <button type="button" disabled={busy !== null || lookup.kind === 'checking'} onClick={() => { void run('import') }}>
          {busy === 'import' ? t('storyboard.importing') : t('storyboard.import')}
        </button>
        {canRefresh && (
          <button type="button" disabled={busy !== null || lookup.kind === 'checking'} onClick={() => {
            setFailure(null)
            setLookup({ kind: 'checking' })
            setRetry(value => value + 1)
          }}>{t('storyboard.refresh')}</button>
        )}
      </div>
      {lookup.kind === 'checking' && <p role="status">{t('storyboard.checking')}</p>}
      {busy === 'generate' && <p role="status">{t('storyboard.generationPending')}</p>}
      {unavailable && diagnostic !== 'storyboard.unavailable' && <p>{t('storyboard.unavailable')}</p>}
      {busy === null && diagnostic !== undefined && <p role="alert">{t(diagnostic)}</p>}
    </div>
  )
}
