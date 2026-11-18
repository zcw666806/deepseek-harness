/** Select the Host route used to draw a confirmed storyboard. */
import { useEffect, useState } from 'react'
import { ChoiceMenu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComicImageGenerationTarget } from '@deepseek-ai/dsh-comic-production/types'
import type { ComicImageModelApi } from './image-model-api.ts'
import type { ComicProductionKey } from './locales.ts'
import css from './ComicImageModel.module.css'

type ImageModelState = Awaited<ReturnType<ComicImageModelApi['load']>>

/**
 * List current image models and persist a selection before exposing it as current.
 * @param props - Session-specific model operations and localized labels.
 * @returns The image generation model control.
 */
export function ComicImageModel({ api, t }: { readonly api: ComicImageModelApi; readonly t: Translate<ComicProductionKey> }) {
  const [state, setState] = useState<ImageModelState>()
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState<'imageModel.loadFailed' | 'imageModel.saveFailed'>()
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const operation = new AbortController()
    setState(undefined)
    setError(undefined)
    void api.load(operation.signal).then((value) => {
      if (!operation.signal.aborted) setState(value)
    }, () => {
      if (!operation.signal.aborted) setError('imageModel.loadFailed')
    })
    return () => operation.abort()
  }, [api, retry])

  const selected = state?.targets.find(target => target.id === state.selected)
  const options = state?.targets.map(target => ({
    id: target.id,
    label: target.title,
    ...(target.title === target.model ? {} : { detail: target.model }),
  })) ?? []
  const empty = state?.targets.length === 0
  const placeholder = empty ? 'imageModel.empty'
    : state === undefined && error === undefined ? 'imageModel.loading' : 'imageModel.choose'
  const choose = async (target: ComicImageGenerationTarget) => {
    setError(undefined)
    setSaving(true)
    try {
      await api.select(target.id)
      setState(current => current === undefined ? undefined : { ...current, selected: target.id })
    } catch {
      setError('imageModel.saveFailed')
    } finally {
      setSaving(false)
    }
  }
  return <div className={css.control}>
    <ChoiceMenu
      label={t('imageModel.label')}
      {...(empty || state?.selected === undefined ? {} : {
        value: selected?.title ?? t('imageModel.unavailable'),
        selectedId: state.selected,
      })}
      placeholder={t(placeholder)}
      options={options}
      busy={saving}
      onSelect={(id) => {
        const target = state?.targets.find(item => item.id === id)
        if (target !== undefined) void choose(target)
      }}
    />
    {empty && <p><button type="button" onClick={() => { setRetry(value => value + 1) }}>{t('imageModel.retry')}</button></p>}
    {error !== undefined && <p role="alert">{t(error)} {error === 'imageModel.loadFailed'
      && <button type="button" onClick={() => { setRetry(value => value + 1) }}>{t('imageModel.retry')}</button>}</p>}
  </div>
}
