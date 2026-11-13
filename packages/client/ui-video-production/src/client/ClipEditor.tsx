/** Non-destructive clip controls with timed captions relative to the adopted source cut. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { VideoCaption, VideoClipEdit } from '@deepseek-ai/dsh-video-production/types'
import css from './VideoProductionView.module.css'

interface ClipEditorProps {
  readonly edit: VideoClipEdit | undefined
  readonly disabled: boolean
  readonly t: PropsLocale<'videoProduction'>['t']
  readonly change: (edit: VideoClipEdit | undefined) => void
}

/**
 * Edit adopted-video cuts, original audio volume and literal timed captions.
 * @param props - Draft values, localized copy and the owning project's mutation callback.
 * @returns Controls whose changes remain drafts until the project is saved.
 */
export function ClipEditor({ edit, disabled, t, change }: ClipEditorProps) {
  const update = (fields: Partial<VideoClipEdit>): void => { change({ ...edit, ...fields }) }
  const caption = (index: number, fields: Partial<VideoCaption>): void => {
    update({ captions: (edit?.captions ?? []).map((value, position) => position === index ? { ...value, ...fields } : value) })
  }
  return <fieldset className={css.clipEditor} disabled={disabled}>
    <legend>{t('edit.title')}</legend>
    <label className={css.field}>{t('edit.start')}<input type="number" min={0} step={0.1}
      value={edit?.trimStartSeconds ?? 0} onChange={(event) => { update({ trimStartSeconds: Number(event.target.value) }) }} /></label>
    <label className={css.field}>{t('edit.end')}<input type="number" min={0} step={0.1}
      value={edit?.trimEndSeconds ?? ''} placeholder={t('edit.sourceEnd')}
      onChange={(event) => { const { trimEndSeconds: _end, ...remaining } = edit ?? {}; change(event.target.value === ''
        ? remaining : { ...remaining, trimEndSeconds: Number(event.target.value) }) }} /></label>
    <label className={css.field}>{t('edit.volume')}<input type="number" min={0} max={4} step={0.1}
      value={edit?.volume ?? 1} onChange={(event) => { update({ volume: Number(event.target.value) }) }} /></label>
    <p className={css.hint}>{t('edit.note')}</p>
    <ol className={css.captionList}>
      {(edit?.captions ?? []).map((value, index) => <li key={index}>
        <label className={css.field}>{t('edit.captionText', { number: index + 1 })}<textarea value={value.text}
          onChange={(event) => { caption(index, { text: event.target.value }) }} /></label>
        <label className={css.field}>{t('edit.captionStart', { number: index + 1 })}<input type="number" min={0} step={0.1}
          value={value.startSeconds} onChange={(event) => { caption(index, { startSeconds: Number(event.target.value) }) }} /></label>
        <label className={css.field}>{t('edit.captionEnd', { number: index + 1 })}<input type="number" min={0} step={0.1}
          value={value.endSeconds} onChange={(event) => { caption(index, { endSeconds: Number(event.target.value) }) }} /></label>
        <button type="button" onClick={() => { update({ captions: (edit?.captions ?? []).filter((_, position) => position !== index) }) }}>{t('edit.removeCaption')}</button>
      </li>)}
    </ol>
    <button type="button" onClick={() => { update({ captions: [...edit?.captions ?? [], { startSeconds: 0, endSeconds: 1, text: '' }] }) }}>{t('edit.addCaption')}</button>
    <button type="button" onClick={() => { change(undefined) }}>{t('edit.reset')}</button>
  </fieldset>
}
