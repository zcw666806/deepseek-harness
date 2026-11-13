/** Operator workflow editor with drafts retained across rejected requests. */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComfyWorkflow, WorkflowConfiguration } from '@deepseek-ai/dsh-video-comfyui/types'
import type { WorkflowFace } from './workflow-controller.ts'
import css from './CapabilitySection.module.css'

/** Framework-owned configuration source and localized callbacks. */
export type WorkflowSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'capabilities'> & InjectFace<WorkflowFace>
const mappingKeys = ['prompt', 'duration', 'width', 'height', 'references', 'outputPrefix', 'durations', 'sizes', 'output'] as const
type Draft = { id: string; title: string; template: string } & Record<typeof mappingKeys[number], string>
function draftOf(workflow?: ComfyWorkflow): Draft {
  return {
    id: workflow?.id ?? '', title: workflow?.title ?? '', template: JSON.stringify(workflow?.template ?? {}, null, 2),
    prompt: JSON.stringify(workflow?.prompt ?? { node: '', input: '' }),
    duration: JSON.stringify(workflow?.duration ?? { node: '', input: '', unit: 'seconds' }),
    width: JSON.stringify(workflow?.width ?? { node: '', input: '' }),
    height: JSON.stringify(workflow?.height ?? { node: '', input: '' }),
    references: JSON.stringify(workflow?.references ?? []),
    outputPrefix: JSON.stringify(workflow?.outputPrefix ?? { node: '', input: '' }),
    durations: JSON.stringify(workflow?.durations ?? []), sizes: JSON.stringify(workflow?.sizes ?? []),
    output: JSON.stringify(workflow?.output ?? { node: '', key: '', index: 0 }),
  }
}

/**
 * Edit API templates and explicit bindings before saving disabled configuration.
 * @param props - framework source, translations and Host callbacks.
 * @returns configuration editor and explicit enable action.
 */
export function WorkflowSection(props: WorkflowSectionProps) {
  const { t } = props
  const state = props.useWorkflows(value => value)
  const [baseURL, setBaseURL] = useState('')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [selected, setSelected] = useState(0)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!state.requested) props.loadWorkflows() }, [state.requested, props.loadWorkflows])
  useEffect(() => {
    if (state.view === null) return
    setBaseURL(state.view.configuration.baseURL ?? '')
    setDrafts(state.view.configuration.workflows.map(draftOf))
    setDirty(false)
    setError(null)
  }, [state.view])
  const draft = drafts[selected]
  function edit(key: keyof Draft, value: string) {
    setDrafts(previous => previous.map((item, index) => index === selected ? { ...item, [key]: value } : item))
    setDirty(true)
    setSubmitted(false)
    setError(null)
  }
  function submit(save: boolean) {
    try {
      const configuration: WorkflowConfiguration = {
        ...(baseURL.trim() === '' ? {} : { baseURL: baseURL.trim() }),
        workflows: drafts.map(item => ({ id: item.id, title: item.title,
          template: JSON.parse(item.template) as ComfyWorkflow['template'],
          ...Object.fromEntries(mappingKeys.map(key => [key, JSON.parse(item[key]) as unknown])),
        } as ComfyWorkflow)),
      }
      setError(null)
      setSubmitted(true)
      if (save) props.saveWorkflows(configuration)
      else props.validateWorkflows(configuration)
    } catch { setError(t('workflow.invalidJson')) }
  }
  return <section className={css.section} aria-label={t('workflow.nav')}>
    <h2>{t('workflow.nav')}</h2><p>{t('workflow.note')}</p>
    {state.error === null ? null : <p role="alert">{t('failed', { message: state.error })}</p>}
    {error === null ? null : <p role="alert">{error}</p>}
    {state.busy ? <p role="status">{t('workflow.pending')}</p> : null}
    {state.validated && submitted ? <p role="status">{t('workflow.valid')}</p> : null}
    {state.view === null ? <button type="button" disabled={state.busy} onClick={props.loadWorkflows}>{t('refresh')}</button> : <>
      <p>{t(state.view.enabled ? 'workflow.enabled' : 'workflow.disabled')}</p>
      <p>{t(state.view.hasHeaders ? 'workflow.headers' : 'workflow.noHeaders')}</p>
      <button type="button" disabled={state.busy} onClick={props.loadWorkflows}>{t('workflow.reload')}</button>
      <fieldset disabled={state.busy} className={css.editor}>
        <label>{t('workflow.baseURL')}<input value={baseURL} onChange={(event) => { setBaseURL(event.target.value); setDirty(true); setSubmitted(false) }} /></label>
        <label>{t('workflow.select')}<select aria-label={t('workflow.select')} value={selected} onChange={(event) => { setSelected(Number(event.target.value)) }}>
          {drafts.map((item, index) => <option key={index} value={index}>{item.title || item.id || t('workflow.untitled')}</option>)}
        </select></label>
        <div className={css.fileActions}>
          <button type="button" onClick={() => { setDrafts([...drafts, draftOf()]); setSelected(drafts.length); setDirty(true); setSubmitted(false) }}>{t('workflow.add')}</button>
          <button type="button" disabled={draft === undefined} onClick={() => { setDrafts(drafts.filter((_, index) => index !== selected)); setSelected(0); setDirty(true); setSubmitted(false) }}>{t('workflow.remove')}</button>
          {state.view.templates.map(template => <button type="button" key={template.workflow.id} disabled={drafts.some(item => item.id === template.workflow.id)} onClick={() => { setDrafts([...drafts, draftOf(template.workflow)]); setSelected(drafts.length); setDirty(true); setSubmitted(false) }}>{t('workflow.diagnostic')}</button>)}
        </div>
        {draft === undefined ? <p>{t('workflow.empty')}</p> : <>
          <label>{t('workflow.id')}<input value={draft.id} onChange={(event) => { edit('id', event.target.value) }} /></label>
          <label>{t('workflow.title')}<input value={draft.title} onChange={(event) => { edit('title', event.target.value) }} /></label>
          <button type="button" onClick={() => { file.current?.click() }}>{t('workflow.import')}</button>
          <input ref={file} type="file" accept=".json" hidden aria-label={t('workflow.file')} onChange={(event) => {
            const selectedFile = event.target.files?.[0]
            event.target.value = ''
            if (selectedFile === undefined) return
            const target = draft
            void selectedFile.text().then((text) => {
              setDrafts(previous => previous.map(item => item === target ? { ...item, template: text } : item))
              setDirty(true)
              setSubmitted(false)
            }, () => { setError(t('workflow.fileError')) })
          }} />
          <label>{t('workflow.template')}<textarea aria-label={t('workflow.template')} rows={10} value={draft.template} onChange={(event) => { edit('template', event.target.value) }} /></label>
          <p>{t('workflow.mappingNote')}</p>
          {mappingKeys.map(key => <label key={key}>{t(`workflow.${key}`)}<textarea aria-label={t(`workflow.${key}`)} rows={2} value={draft[key]} onChange={(event) => { edit(key, event.target.value) }} /></label>)}
        </>}
        <div className={css.fileActions}>
          <button type="button" onClick={() => { submit(false) }}>{t('workflow.validate')}</button>
          <button type="button" onClick={() => { submit(true) }}>{t('workflow.save')}</button>
          <button type="button" disabled={dirty || drafts.length === 0} onClick={() => { props.enableWorkflows(!state.view?.enabled) }}>{t(state.view.enabled ? 'workflow.disable' : 'workflow.enable')}</button>
        </div>
      </fieldset>
    </>}
  </section>
}
