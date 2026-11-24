/** Model selector for video generated from the current conversation. */
import { useEffect, useRef, useState } from 'react'
import { ChoiceMenu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { VideoGenerationTarget } from '@deepseek-ai/dsh-video-production/types'
import type { NS } from './locales.ts'
import css from './ConversationVideoModel.module.css'

interface ModelState {
  readonly targets: readonly VideoGenerationTarget[]
  readonly selected: string | undefined
}

type Props = PropsRuntime<'conversation.input.creation-model', 'video'> & PropsLocale<typeof NS> & {
  readonly load: (signal: AbortSignal) => Promise<ModelState>
  readonly select: (model: string, signal: AbortSignal) => Promise<void>
}

/**
 * Load and save the standalone generation model for this Session.
 * @param props - Session-scoped operations and localized labels.
 * @returns The compact composer model control.
 */
export function ConversationVideoModel({ t, load, select }: Props) {
  const [state, setState] = useState<ModelState>()
  const [error, setError] = useState<'conversationModel.loadFailed' | 'conversationModel.saveFailed'>()
  const [retry, setRetry] = useState(0)
  const [saving, setSaving] = useState(false)
  const operation = useRef<AbortController>()

  useEffect(() => {
    const controller = new AbortController()
    operation.current = controller
    setState(undefined)
    setError(undefined)
    setSaving(false)
    void load(controller.signal).then((value) => {
      if (!controller.signal.aborted) setState(value)
    }, () => {
      if (!controller.signal.aborted) setError('conversationModel.loadFailed')
    })
    return () => { controller.abort(); operation.current = undefined }
  }, [load, retry])

  const selectedId = state?.selected ?? (state?.targets.length === 1 ? state.targets[0]?.model : undefined)
  const selected = state?.targets.find(target => target.model === selectedId)
  const options = state?.targets.flatMap(target => target.model === undefined ? [] : [{
    id: target.model,
    label: target.model,
    ...(target.title === target.model ? {} : { detail: target.title }),
  }]) ?? []
  const empty = state !== undefined && options.length === 0
  const placeholder = empty ? 'conversationModel.empty'
    : state === undefined && error === undefined ? 'conversationModel.loading' : 'conversationModel.choose'

  async function choose(model: string) {
    const signal = operation.current?.signal
    if (signal === undefined || signal.aborted) return
    setError(undefined)
    setSaving(true)
    try {
      await select(model, signal)
      if (!signal.aborted) setState(current => current === undefined ? undefined : { ...current, selected: model })
    } catch {
      if (!signal.aborted) setError('conversationModel.saveFailed')
    } finally {
      if (!signal.aborted) setSaving(false)
    }
  }

  return (
    <div className={css.root}>
      <ChoiceMenu
        label={t('generation.target')}
        {...(empty || selectedId === undefined ? {} : { value: selected?.model ?? t('generation.unavailable'), selectedId })}
        placeholder={t(placeholder)}
        options={options}
        busy={saving}
        onSelect={(id) => { void choose(id) }}
      />
      {error !== undefined && (
        <div role="alert">
          {t(error)}
          {error === 'conversationModel.loadFailed' && (
            <button type="button" onClick={() => { setRetry(value => value + 1) }}>{t('conversationModel.retry')}</button>
          )}
        </div>
      )}
    </div>
  )
}
