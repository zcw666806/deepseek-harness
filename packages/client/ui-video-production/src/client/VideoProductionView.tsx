/** Editable storyboard, reference assets, video previews, and film sequence. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsStore } from '@deepseek-ai/dsh-client-store'
import type {
  VideoAsset, VideoAssetId, VideoProject, VideoProjectInput, VideoShot,
  VideoShotId, VideoShotInput, VideoVersion, VideoVersionId,
} from '@deepseek-ai/dsh-video-production/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ProductionFace } from './controller.ts'
import { gridPoint, type createVideoCanvasStore } from './canvas-store.ts'
import { acceptsShot, generationTargetKey } from './generation-target.ts'
import { WorkflowCanvas } from './WorkflowCanvas.tsx'
import { ClipEditor } from './ClipEditor.tsx'
import css from './VideoProductionView.module.css'

/** Props bound by the Conversation view entry and its private canvas store. */
export type VideoProductionViewProps =
  PropsRuntime<'conversation.view'>
  & PropsLocale<'videoProduction'>
  & PropsStore<ReturnType<typeof createVideoCanvasStore>>
  & InjectFace<ProductionFace>

function editable(project: VideoProject): VideoProjectInput {
  return {
    revision: project.revision, title: project.title, assets: project.assets,
    shots: project.shots.map(({ versions: _versions, ...shot }) => shot),
  }
}

function editableFingerprint(input: VideoProjectInput): string {
  return JSON.stringify({ ...input, revision: 0 })
}

/**
 * Resolve the selected completed version without displaying an unfinished attempt.
 * @param shot - saved shot with generation history.
 * @returns the selected completed version, otherwise its latest completed version.
 */
export function selectedVersion(shot: VideoShot): VideoVersion | undefined {
  return shot.versions.find(version => version.id === shot.selectedVersionId && version.status === 'completed')
    ?? [...shot.versions].reverse().find(version => version.status === 'completed')
}

/**
 * Move a shot within the film sequence, preserving every other relative order.
 * @param ids - the current saved sequence.
 * @param id - moving shot identity.
 * @param targetIndex - requested destination, clamped to the sequence.
 * @returns the next complete sequence.
 */
export function reorderedShotIds(ids: readonly VideoShotId[], id: VideoShotId, targetIndex: number): VideoShotId[] {
  const source = ids.indexOf(id)
  if (source < 0) return [...ids]
  const result = ids.filter(value => value !== id)
  result.splice(Math.max(0, Math.min(result.length, targetIndex)), 0, id)
  return result
}

function valid(input: VideoProjectInput): boolean {
  return input.title.trim().length > 0 && input.shots.every(shot =>
    shot.title.trim().length > 0 && shot.prompt.trim().length > 0
    && Number.isInteger(shot.duration) && shot.duration >= 1 && shot.duration <= 15
    && (shot.edit === undefined || (
      Number.isFinite(shot.edit.trimStartSeconds ?? 0) && (shot.edit.trimStartSeconds ?? 0) >= 0
      && (shot.edit.trimEndSeconds === undefined || (Number.isFinite(shot.edit.trimEndSeconds)
        && shot.edit.trimEndSeconds > (shot.edit.trimStartSeconds ?? 0)))
      && Number.isFinite(shot.edit.volume ?? 1) && (shot.edit.volume ?? 1) >= 0 && (shot.edit.volume ?? 1) <= 4
      && (shot.edit.captions ?? []).every(caption => Number.isFinite(caption.startSeconds) && caption.startSeconds >= 0
        && Number.isFinite(caption.endSeconds) && caption.endSeconds > caption.startSeconds && caption.text.length > 0
        && !caption.text.includes('\u0000')))))
}

function hasSelectedVideo(shot: VideoShot): boolean {
  return shot.versions.some(version => version.id === shot.selectedVersionId
    && version.status === 'completed' && version.attachment !== undefined)
}

/**
 * Render one Session-owned video project and dispatch only explicit user actions.
 * @param props - localized copy, framework hooks, canvas actions, and project callbacks.
 * @returns the video production workspace.
 */
export function VideoProductionView(props: VideoProductionViewProps) {
  const { t, actions } = props
  const state = props.useProduction(snapshot => snapshot)
  const canvas = props.useStore(snapshot => snapshot)
  const [draft, setDraft] = useState<VideoProjectInput | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [targetKey, setTargetKey] = useState<string | null>(null)
  const initializedTarget = useRef(false)
  const [assetName, setAssetName] = useState('')
  const [libraryPreference, setLibraryPreference] = useState<boolean | null>(null)
  const [assetKind, setAssetKind] = useState<VideoAsset['kind']>('character')
  const fileInput = useRef<HTMLInputElement>(null)
  const packageInput = useRef<HTMLInputElement>(null)
  const lastSubmitted = useRef<string | null>(null)

  useEffect(() => {
    if (state.project === null && state.operation === null && state.error === null) props.refresh()
  }, [props.refresh, state.project, state.operation, state.error])
  useEffect(() => {
    if (state.project !== null && lastSubmitted.current === editableFingerprint(editable(state.project))) {
      setDraft(null)
      lastSubmitted.current = null
    }
  }, [state.project])
  useEffect(() => {
    for (const asset of state.project?.assets ?? []) {
      if (asset.image !== undefined) props.loadMedia(asset.image)
    }
  }, [state.project, props.loadMedia])

  useEffect(() => {
    if (state.targets === null || initializedTarget.current) return
    initializedTarget.current = true
    const sole = state.targets.length === 1 ? state.targets[0] : undefined
    if (sole !== undefined) setTargetKey(generationTargetKey(sole))
  }, [state.targets])
  const target = state.targets?.find(item => generationTargetKey(item) === targetKey)
  const selection = target === undefined ? null : {
    generator: target.generator, ...target.model === undefined ? {} : { model: target.model },
  }
  const project = state.project
  const input = draft ?? (project === null ? null : editable(project))
  const libraryOpen = libraryPreference ?? input?.shots.length === 0
  const requestBusy = state.operation !== null
  const batchLive = state.batch !== null && ['running', 'pausing', 'cancelling'].includes(state.batch.status)
  const busy = requestBusy || batchLive
  const batchBlocksNew = state.batch !== null && (state.batch.shots.some(shot => shot.status === 'uncertain' || shot.status === 'running')
    || !['completed', 'cancelled'].includes(state.batch.status))
  const dirty = draft !== null
  const conflicted = dirty && input?.revision !== project?.revision
  const selected = input?.shots.find(shot => shot.id === canvas.selectedShotId)
  const savedById = useMemo(() => new Map(project?.shots.map(shot => [shot.id, shot]) ?? []), [project])
  const stagedProject = project === null || input === null ? null : {
    ...project, ...input,
    shots: input.shots.map(shot => ({ ...shot, versions: savedById.get(shot.id)?.versions ?? [] })),
  }
  const seconds = (project?.shots ?? []).reduce(
    (sum, shot) => sum + Math.max(0, (shot.edit?.trimEndSeconds ?? selectedVersion(shot)?.attachment?.durationSeconds ?? shot.duration)
      - (shot.edit?.trimStartSeconds ?? 0)), 0,
  )

  const change = (transform: (value: VideoProjectInput) => VideoProjectInput): void => {
    if (input === null || busy) return
    setDraft(transform(input))
    setInvalid(false)
  }
  const editShot = (id: VideoShotId, fields: Partial<VideoShotInput>): void => {
    change(value => ({ ...value, shots: value.shots.map(shot => shot.id === id ? { ...shot, ...fields } : shot) }))
  }
  const moveReference = (index: number, offset: -1 | 1): void => {
    if (selected === undefined) return
    const assetIds = [...selected.assetIds]
    const moving = assetIds.splice(index, 1)
    assetIds.splice(index + offset, 0, ...moving)
    editShot(selected.id, { assetIds })
  }
  const select = (id: VideoShotId): void => {
    actions.select(id)

  }
  const move = (id: VideoShotId, target: number): void => {
    if (project === null || busy || dirty) return
    props.reorder(reorderedShotIds(project.shots.map(shot => shot.id), id, target))
  }
  const addShot = (): void => {
    if (input === null) return
    const id = randomUUID() as VideoShotId
    change(value => ({ ...value, shots: [...value.shots, {
      id, title: t('shot.new', { number: value.shots.length + 1 }), prompt: '', duration: 6,
      aspectRatio: '16:9', resolution: '480p', assetIds: [], position: gridPoint(value.shots.length),
    }] }))
    actions.select(id)
  }
  const save = (): void => {
    if (input === null || !valid(input)) { setInvalid(true); return }
    lastSubmitted.current = editableFingerprint(input)
    props.save(input)
  }

  if (project === null || input === null || stagedProject === null) {
    return <section className={css.workspace} aria-label={t('view.title')}>
      <p>{t('project.loading')}</p>
      {state.error === null ? null : <p role="alert">{state.error}</p>}
      <button type="button" disabled={busy} onClick={props.refresh}>{t('project.refresh')}</button>
    </section>
  }

  return <section className={css.workspace} aria-label={t('view.title')}>
    <header className={css.toolbar}>
      <button type="button" aria-expanded={libraryOpen} onClick={() => { setLibraryPreference(!libraryOpen) }}>{t('asset.library')}</button>
      <input
        className={css.projectTitle} aria-label={t('project.title')} value={input.title}
        placeholder={t('project.untitled')} disabled={busy}
        onChange={(event) => { change(value => ({ ...value, title: event.target.value })) }}
      />
      <label className={css.targetField}>{t('generation.target')}<select
        aria-label={t('generation.target')} value={targetKey ?? ''} disabled={busy || state.targets === null}
        onChange={(event) => { setTargetKey(event.target.value || null) }}
      ><option value="">{t('generation.choose')}</option>{targetKey !== null && target === undefined ? <option value={targetKey}>{t('generation.unavailable')}</option> : null}{state.targets?.map(item => <option key={generationTargetKey(item)} value={generationTargetKey(item)}>{item.model === undefined ? item.title : t('generation.option', { title: item.title, model: item.model })}</option>)}</select></label>
      <span className={css.saveState}>{t(dirty ? 'project.unsaved' : 'project.saved')}</span>
      <button type="button" disabled={busy} onClick={() => { setDraft(null); lastSubmitted.current = null; props.refresh() }}>{t('project.refresh')}</button>
      <button type="button" disabled={busy || !dirty || conflicted} onClick={save}>{t('project.save')}</button>
      <button type="button" disabled={busy || dirty} onClick={props.exportProject}>{t('transfer.export')}</button>
      <button type="button" disabled={busy || dirty || project.revision !== 0} title={project.revision !== 0 ? t('transfer.emptyRequired') : undefined} onClick={() => { packageInput.current?.click() }}>{t('transfer.import')}</button>
      <input ref={packageInput} type="file" hidden accept=".dshvideo" aria-label={t('transfer.choose')} onChange={(event) => { const file = event.target.files?.[0]; if (file !== undefined) props.importProject(file); event.target.value = '' }} />
      <button type="button" disabled={busy} onClick={addShot}>{t('shot.add')}</button>
      <button type="button" disabled={busy || batchBlocksNew || dirty || target === undefined || project.shots.some(shot => !shot.versions.some(version => version.status === 'completed' && version.attachment !== undefined) && !acceptsShot(target, shot)) || !project.shots.some(shot => !shot.versions.some(version => version.status === 'completed' && version.attachment !== undefined))} onClick={() => { if (selection !== null) props.generateMissing(selection) }}>{t('batch.action')}</button>
      {state.operation?.kind === 'generate' || state.operation?.kind === 'export' || state.operation?.kind === 'transfer' || state.operation?.kind === 'restoreCapabilities'
        ? <button type="button" onClick={props.cancel}>{t('operation.cancel')}</button>
        : null}
    </header>
    {state.batch === null ? null : <section className={css.transferProgress} aria-label={t('batch.title')}>
      <strong>{t(`batch.status.${state.batch.status}`)}</strong>
      <span role="status">{t('batch.progress', { completed: state.batch.shots.filter(shot => shot.status === 'completed').length, total: state.batch.shots.length })}</span>
      <button type="button" disabled={requestBusy || state.batch.status !== 'running'} onClick={props.pauseBatch}>{t('batch.pause')}</button>
      <button type="button" disabled={requestBusy || dirty || batchLive || !state.batch.shots.some(shot => shot.status === 'pending')} onClick={props.resumeBatch}>{t('batch.resume')}</button>
      <button type="button" disabled={requestBusy || ['completed', 'cancelled', 'cancelling'].includes(state.batch.status)} onClick={props.cancelBatch}>{t('batch.cancel')}</button>
      <p>{t('batch.boundary')}</p>
      {state.batch.shots.some(shot => shot.status === 'uncertain') ? <p role="alert">{t('batch.review')}</p> : null}
      {state.batch.error === undefined ? null : <p role="alert">{state.batch.error}</p>}
    </section>}
    {state.transfer === null ? null : <div className={css.transferProgress} role="status"><span>{t(state.transfer.direction === 'export' ? 'transfer.exporting' : 'transfer.importing')}</span>{state.transfer.total === 0 ? null : <><progress aria-label={t('transfer.progress')} max={state.transfer.total} value={state.transfer.completed} /><span>{t('transfer.bytes', { completed: state.transfer.completed, total: state.transfer.total })}</span></>}</div>}
    {state.projectDownload === null ? null : <p className={css.transferProgress}><a href={state.projectDownload.url} download={state.projectDownload.fileName}>{t('transfer.download')}</a><span>{t('transfer.note')}</span></p>}
    {state.restored === null ? null : <div className={css.transferProgress} role="status"><span>{t('transfer.restored')}</span>{state.restored.capabilities === undefined ? null : <button type="button" disabled={busy} onClick={props.restoreCapabilities}>{t('transfer.restoreCapabilities')}</button>}{state.restored.requirements.length === 0 ? null : <ul aria-label={t('transfer.requirements')}>{state.restored.requirements.map((item, index) => <li key={index}>{item.generator}{item.model === undefined ? null : ` · ${item.model}`}{item.revision === undefined ? null : ` · ${item.revision}`}</li>)}</ul>}</div>}
    {state.capabilityRestorations.length === 0 ? null : <ul className={css.transferProgress} aria-label={t('transfer.capabilityResults')}>{state.capabilityRestorations.map(item => <li key={item.id}>{item.id} · {t(`transfer.cap.${item.status}`)}{item.message === undefined ? null : <p>{item.message}</p>}</li>)}</ul>}
    {state.error === null ? null : <p className={css.error} role="alert">{t('operation.failed')}: {state.error}</p>}
    {state.operation?.kind === 'batch' ? <p className={css.batchProgress} role="status">{t('batch.progress', { completed: state.operation.completed, total: state.operation.total })}</p> : null}
    {state.batchIssue == null ? null : <p className={css.error} role="alert">{t(`batch.${state.batchIssue.reason}`)}</p>}
    {state.targets?.length === 0 ? <p className={css.hint}>{t('generation.empty')}</p> : targetKey !== null && target === undefined ? <p className={css.error} role="alert">{t('generation.unavailable')}</p> : null}
    {invalid ? <p className={css.error} role="alert">{t('form.invalid')}</p> : null}
    {conflicted ? <p className={css.error} role="alert">{t('project.conflict')}</p> : null}
    <div className={css.body}>
      {libraryOpen ? <aside className={css.sidebar} aria-label={t('asset.library')}>
        <h3>{t('asset.title')}</h3>
        {input.assets.length === 0 ? <p className={css.hint}>{t('asset.empty')}</p> : null}
        <div className={css.assets}>
          {input.assets.map(asset => <article className={css.asset} key={asset.id}>
            {asset.image !== undefined && state.media[asset.image.attachmentId] !== undefined
              ? <img src={state.media[asset.image.attachmentId]} alt={asset.name} /> : null}
            <span>{asset.name}</span>
            <small>{t(asset.kind === 'prop' ? 'asset.reference' : `asset.${asset.kind}`)}</small>
            <button type="button" aria-label={t('asset.remove')} disabled={busy} onClick={() => {
              change(value => ({ ...value, assets: value.assets.filter(item => item.id !== asset.id),
                shots: value.shots.map(shot => ({ ...shot, assetIds: shot.assetIds.filter(id => id !== asset.id) })),
              }))
            }}>×</button>
          </article>)}
        </div>
        <label className={css.field}>{t('asset.name')}<input value={assetName} disabled={busy || dirty} onChange={(event) => { setAssetName(event.target.value) }} /></label>
        <label className={css.field}>{t('asset.kind')}<select value={assetKind} disabled={busy || dirty} onChange={(event) => { setAssetKind(event.target.value as VideoAsset['kind']) }}>
          <option value="character">{t('asset.character')}</option><option value="scene">{t('asset.scene')}</option><option value="prop">{t('asset.reference')}</option>
        </select></label>
        <input
          ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" aria-label={t('asset.choose')}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) props.addAsset(file, assetName.trim() || file.name, assetKind)
            event.target.value = ''
          }}
        />
        <button type="button" disabled={busy || dirty} onClick={() => { fileInput.current?.click() }}>{t('asset.add')}</button>
        <p className={css.hint}>{t('asset.note')}</p>

      </aside> : null}
      <main className={css.main}>
        <WorkflowCanvas
          project={stagedProject} state={state} canvas={canvas} actions={actions} t={t} dirty={dirty}
          edit={(value) => { change(() => value) }} editShot={editShot} target={target ?? null}
          generate={(shotId) => { if (selection !== null) props.generate(shotId, selection) }} loadMedia={props.loadMedia}
        />
        <section className={css.timeline} aria-label={t('timeline.title')}>
          <header><h3>{t('timeline.title')}</h3><span>{t('timeline.total', { count: project.shots.length, seconds: Math.round(seconds * 10) / 10 })}</span>
            <button type="button" disabled={busy || dirty || project.shots.length === 0 || project.shots.some(shot => !hasSelectedVideo(shot))} title={project.shots.some(shot => !hasSelectedVideo(shot)) ? t('export.requiresVideo') : undefined} onClick={props.exportFilm}>{t(state.operation?.kind === 'export' ? 'export.running' : 'export.action')}</button>
          </header>
          <ol className={css.sequence}>
            {project.shots.map((shot, index) => <li key={shot.id} draggable={!busy && !dirty}
              onDragStart={(event) => { event.dataTransfer.setData('text/plain', shot.id) }}
              onDragOver={(event) => { if (!busy && !dirty) event.preventDefault() }}
              onDrop={(event) => { event.preventDefault(); move(event.dataTransfer.getData('text/plain') as VideoShotId, index) }}
            >
              <button type="button" className={css.sequenceSelect} onClick={() => { select(shot.id) }}><strong>{index + 1}</strong>{selectedVersion(shot)?.attachment !== undefined && state.media[selectedVersion(shot)?.attachment?.attachmentId ?? ''] !== undefined ? <video className={css.sequenceThumb} muted preload="metadata" src={state.media[selectedVersion(shot)?.attachment?.attachmentId ?? '']} aria-label={t('shot.preview', { title: shot.title })} /> : <span className={css.sequencePlaceholder}>▶</span>}<span>{shot.title}</span><small>{t('shot.seconds', { seconds: shot.duration })}</small></button>
              <div><button type="button" aria-label={t('shot.moveEarlier')} disabled={busy || dirty || index === 0} onClick={() => { move(shot.id, index - 1) }}>←</button><button type="button" aria-label={t('shot.moveLater')} disabled={busy || dirty || index === project.shots.length - 1} onClick={() => { move(shot.id, index + 1) }}>→</button></div>
            </li>)}
          </ol>
          {project.shots.length === 0 ? <p className={css.hint}>{t('timeline.empty')}</p> : null}
          {project.exports.at(-1)?.error === undefined ? null : <p role="alert" className={css.error}>{project.exports.at(-1)?.error}</p>}
        </section>
      </main>
      {selected === undefined ? null : <aside className={css.rightInspector} aria-label={t('workflow.inspect')}><h3>{t('workflow.inspect')}</h3>
        <div className={css.inspector}>
          <h3>{selected.title}</h3>
          <button type="button" disabled={busy} onClick={() => { const id = randomUUID() as VideoShotId; const { selectedVersionId: _selected, ...source } = selected; change(value => ({ ...value, shots: [...value.shots, { ...source, id }] })); actions.select(id) }}>{t('workflow.copy')}</button>
          <label className={css.field}>{t('shot.versions')}<select aria-label={t('shot.versions')} value={selected.selectedVersionId ?? ''} disabled={busy} onChange={(event) => { editShot(selected.id, { selectedVersionId: event.target.value as VideoVersionId }) }}><option value="" disabled>{t('shot.selectVersion')}</option>{savedById.get(selected.id)?.versions.filter(version => version.status === 'completed').map((version, index) => <option key={version.id} value={version.id}>{t('shot.version', { number: index + 1 })}</option>)}</select></label>
          <label className={css.field}>{t('shot.duration')}<input type="number" min={1} max={15} step={1} value={selected.duration} disabled={busy} onChange={(event) => { editShot(selected.id, { duration: Number(event.target.value) }) }} /></label>
          <label className={css.field}>{t('shot.ratio')}<select value={selected.aspectRatio} disabled={busy} onChange={(event) => { editShot(selected.id, { aspectRatio: event.target.value as VideoShotInput['aspectRatio'] }) }}>
            <option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option>
          </select></label>
          <label className={css.field}>{t('shot.resolution')}<select value={selected.resolution} disabled={busy} onChange={(event) => { editShot(selected.id, { resolution: event.target.value as VideoShotInput['resolution'] }) }}>
            <option value="480p">{t('resolution.480p')}</option><option value="720p">{t('resolution.720p')}</option>
          </select></label>
          <ClipEditor edit={selected.edit} disabled={busy} t={t} change={(edit) => { editShot(selected.id, { edit }) }} />
          <fieldset className={css.references}>
            <legend>{t('shot.references')}</legend>{input.assets.map(asset => <label key={asset.id}>
              <input type="checkbox" checked={selected.assetIds.includes(asset.id)} disabled={busy} onChange={(event) => {
                const assetIds: readonly VideoAssetId[] = event.target.checked
                  ? [...selected.assetIds, asset.id] : selected.assetIds.filter(id => id !== asset.id)
                editShot(selected.id, { assetIds })
              }} />{asset.name}
            </label>)}</fieldset>
          <h3>{t('shot.referenceOrder')}</h3>
          <ol className={css.referenceOrder} aria-label={t('shot.referenceOrder')}>
            {selected.assetIds.map((assetId, index) => {
              const name = input.assets.find(asset => asset.id === assetId)?.name ?? assetId
              return <li key={assetId}><span>{index + 1}</span><strong>{name}</strong>
                <button type="button" aria-label={t('reference.moveEarlier', { name })} disabled={busy || index === 0} onClick={() => { moveReference(index, -1) }}>↑</button>
                <button type="button" aria-label={t('reference.moveLater', { name })} disabled={busy || index === selected.assetIds.length - 1} onClick={() => { moveReference(index, 1) }}>↓</button>
              </li>
            })}
          </ol>
          <button type="button" disabled={busy} onClick={() => { change(value => ({ ...value, shots: value.shots.filter(shot => shot.id !== selected.id) })); actions.select(null) }}>{t('shot.remove')}</button>
        </div>
      </aside>}
    </div>
  </section>
}
