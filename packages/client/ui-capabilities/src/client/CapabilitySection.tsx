/** Capability reports and fixed Host-advertised actions inside global settings. */
import { useEffect, useRef } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CapabilityFace } from './controller.ts'
import css from './CapabilitySection.module.css'

/** Framework-bound data, locale and callbacks for the settings contribution. */
export type CapabilitySectionProps = PropsRuntime<'settings.section'> & PropsLocale<'capabilities'> & InjectFace<CapabilityFace>

/**
 * Render authoritative capability status without exposing executable commands.
 * @param props - framework hooks, localized copy and Host callbacks.
 * @returns capability cards and current-operation feedback.
 */
export function CapabilitySection(props: CapabilitySectionProps) {
  const { t } = props
  const file = useRef<HTMLInputElement>(null)
  const state = props.useCapabilities(value => value)
  useEffect(() => {
    if (!state.requested && state.operation === null) props.refresh()
  }, [state.requested, state.operation, props.refresh])
  const busy = state.operation !== null
  return <section className={css.section} aria-label={t('nav')}>
    <header className={css.header}><div><h2>{t('nav')}</h2><p>{t('summary')}</p></div>
      <button type="button" disabled={busy} onClick={props.refresh}>{t('refresh')}</button>
    </header>
    <div className={css.fileActions}><button type="button" disabled={busy} onClick={props.exportManifest}>{t('manifest.export')}</button><button type="button" disabled={busy} onClick={() => { file.current?.click() }}>{t('manifest.import')}</button><input ref={file} type="file" accept=".json" hidden aria-label={t('manifest.choose')} onChange={(event) => { const selected = event.target.files?.[0]; if (selected !== undefined) props.restoreFile(selected); event.target.value = '' }} />{state.manifestDownload === null ? null : <a href={state.manifestDownload} download="dsh-capabilities.json">{t('manifest.download')}</a>}</div>
    <p className={css.manifestNote}>{t('manifest.note')}</p>
    {state.restorePlan === null ? null : <section className={css.restorePlan} aria-label={t('manifest.preview')}>
      <h3>{t('manifest.preview')}</h3><p>{t('manifest.previewNote')}</p>
      <ul className={css.requirements}>{state.restorePlan.items.map(item => <li key={item.id}>
        <div><strong>{item.current?.title ?? item.id}</strong><span>{t(`plan.${item.status}`)}</span></div>
        <p>{t('engine', { engine: item.expectedEngineId })}
          {item.expectedVersion === undefined ? null : ` · ${t('version', { version: item.expectedVersion })}`}</p>
        <p>{t(`configuration.${item.configuration}`)}</p>
        {item.current === undefined ? null : <p>{t('plan.current', { status: t(`status.${item.current.status}`) })}</p>}
        {item.message === undefined ? null : <p>{item.message}</p>}
        {item.current?.requirements.map(requirement => <p key={requirement.id}>
          {requirement.title} · {t(`requirement.${requirement.status}`)}
          {requirement.message === undefined ? null : ` · ${requirement.message}`}</p>)}
      </li>)}</ul>
      <div className={css.fileActions}>
        <button type="button" disabled={busy} onClick={props.applyRestoration}>{t('manifest.apply')}</button>
        <button type="button" disabled={busy} onClick={props.discardRestoration}>{t('manifest.discard')}</button>
      </div>
    </section>}
    {state.restorations.length === 0 ? null : <ul aria-label={t('manifest.results')}>{state.restorations.map(result => <li key={result.id}><strong>{state.items?.find(item => item.id === result.id)?.title ?? result.id}</strong> · {t(`restore.${result.status}`)}{result.message === undefined ? null : <p>{result.message}</p>}</li>)}</ul>}
    {state.error === null ? null : <p role="alert" className={css.error}>{t('failed', { message: state.error })}</p>}
    {busy ? <div className={css.pending} role="status"><span>{state.cancelling ? t('cancelling') : state.operation.kind === 'action' ? t('pending', { action: t(`action.${state.operation.action}`) }) : t(state.operation.kind === 'manifestExport' ? 'manifest.exporting' : state.operation.kind === 'manifestRestore' ? 'manifest.restoring' : state.operation.kind === 'manifestPlan' ? 'manifest.planning' : 'loading')}</span><button type="button" disabled={state.cancelling} onClick={props.cancel}>{t('cancel')}</button></div> : null}
    {state.items?.length === 0 ? <p>{t('empty')}</p> : null}
    <div className={css.cards}>{state.items?.map(item => <article key={item.id} className={css.card} aria-label={item.title}>
      <header><div><h3>{item.title}</h3><span>{t(`kind.${item.kind}`)}</span></div><strong className={css.status} data-status={item.status}>{t(`status.${item.status}`)}</strong></header>
      <p>{item.description}</p>
      <div className={css.metadata}><span>{t('engine', { engine: item.engineId })}</span>{item.version === undefined ? null : <span>{t('version', { version: item.version })}</span>}{item.owned === true ? <span>{t('owned')}</span> : item.kind === 'local' && item.owned === false ? <span>{t('external')}</span> : null}</div>
      {item.message === undefined ? null : <p className={css.message}>{item.message}</p>}
      {item.requirements.length === 0 ? null : <div><h4>{t('requirements')}</h4><ul className={css.requirements}>{item.requirements.map(requirement => <li key={requirement.id}><div><strong>{requirement.title}</strong><span data-status={requirement.status}>{t(`requirement.${requirement.status}`)}</span></div>{requirement.message === undefined ? null : <p>{requirement.message}</p>}</li>)}</ul></div>}
      <footer>{item.actions.map(action => <button type="button" key={action} disabled={busy || (action === 'stop' && (item.status === 'missing' || item.status === 'stopped' || (item.kind === 'local' && item.owned !== true)))} onClick={() => { props.perform(item.id, action) }}>{t(`action.${action}`)}</button>)}</footer>
    </article>)}</div>
  </section>
}
