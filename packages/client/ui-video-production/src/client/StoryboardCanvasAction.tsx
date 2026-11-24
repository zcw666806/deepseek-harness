/** Opens the video canvas from a project document named in a settled reply. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { NS, VideoProductionKey } from './locales.ts'
import css from './StoryboardCanvasAction.module.css'

const videoContext = /视频|镜头|逐镜|竖屏|横屏|出片|\d+\s*秒|\b(?:video|shots?|clips?)\b/iu
const storyboardFile = /(?:^|[/\\])storyboard\.md$/iu

function namedStoryboard(text: string): string | undefined {
  if (!videoContext.test(text)) return undefined
  const links = text.matchAll(/\[[^\]\r\n]+\]\(\s*(<[^>\r\n]+>|[^)\r\n]+)\s*\)/gu)
  for (const [, link] of links) {
    if (link === undefined) continue
    const target = link.trim().replace(/^<|>$/gu, '').split('#', 1)[0] ?? ''
    if (/^(?:https?:|data:)/iu.test(target)) continue
    try {
      const decoded = decodeURIComponent(target)
        .replace(/^file:\/\/\/(?=[a-z]:)/iu, '')
        .replace(/^file:\/\//iu, '')
      if (storyboardFile.test(decoded)) return decoded
    } catch (_error) {
      continue
    }
  }

  for (const [, path] of text.matchAll(/`([^`\r\n]+)`/gu)) {
    if (path !== undefined && path !== 'storyboard.md' && storyboardFile.test(path)) return path
  }
  if (!/\bstoryboard\.md\b/iu.test(text)) return undefined
  const folder = /(?:项目(?:目录)?(?:在|为)|\bproject(?: folder)?\s+(?:is(?:\s+in)?|at|in))\s*[:：]?\s*`([^`\r\n]+)`/iu.exec(text)?.[1]
  return folder === undefined ? undefined : `${folder}/storyboard.md`
}

function failureKey(error: unknown): VideoProductionKey {
  const details = typeof error === 'object' && error !== null && 'details' in error ? error.details : undefined
  const reason = typeof details === 'object' && details !== null && 'reason' in details ? details.reason : undefined
  if (reason === 'storyboard-path' || reason === 'storyboard-read') return 'storyboard.readFailed'
  return reason === 'storyboard-format' ? 'storyboard.formatFailed' : 'storyboard.openFailed'
}

type Props = PropsRuntime<'conversation.chat.assistant-follow-up'> & PropsLocale<typeof NS> & {
  readonly openStoryboard: (path: string, signal: AbortSignal) => Promise<void>
}

/**
 * Offer the editable canvas beneath a settled reply that points to a video storyboard.
 * @param props - The reply, localized labels, and Session-scoped import action.
 * @returns The canvas action and its local feedback, if the reply names a storyboard.
 */
export function StoryboardCanvasAction({ text, openStoryboard, t }: Props) {
  const path = namedStoryboard(text)
  const active = useRef<AbortController | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<VideoProductionKey | null>(null)
  useEffect(() => () => { active.current?.abort() }, [])
  if (path === undefined) return null

  function open() {
    if (path === undefined || active.current !== null) return
    const operation = new AbortController()
    active.current = operation
    setPending(true)
    setError(null)
    void openStoryboard(path, operation.signal).catch((failure: unknown) => {
      if (!operation.signal.aborted) setError(failureKey(failure))
    }).finally(() => {
      active.current = null
      if (!operation.signal.aborted) setPending(false)
    })
  }

  return <div className={css.action}>
    <Button variant="outline" size="sm" onClick={open} disabled={pending}>
      {t(pending ? 'storyboard.opening' : 'storyboard.open')}
    </Button>
    {error !== null && <p role="alert">{t(error)}</p>}
  </div>
}
