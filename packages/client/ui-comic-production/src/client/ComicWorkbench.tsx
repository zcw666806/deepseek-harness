/** Page composition, lettering, and single-layer artwork exchange. */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {
  ComicBubble, ComicBubbleId, ComicDraft, ComicImage, ComicImageId, ComicLayer, ComicLayerId,
  ComicPage, ComicPageId, ComicPanel, ComicPanelId, ComicProject, ComicProjectId, ComicProjectSummary,
} from '@deepseek-ai/dsh-comic-production/types'
import type { ComicProductionKey } from './locales.ts'
import { canvasPng, drawComicPage, pageArtwork, renderArtwork, type ComicArtwork } from './renderer.ts'
import css from './ComicWorkbench.module.css'

/** File and project operations supplied by the authenticated comic view. */
export interface ComicWorkbenchApi {
  list(signal?: AbortSignal): Promise<readonly ComicProjectSummary[]>
  create(title: string, signal?: AbortSignal): Promise<ComicProject>
  open(projectId: ComicProjectId, signal?: AbortSignal): Promise<ComicProject>
  save(projectId: ComicProjectId, revision: number, draft: ComicDraft, signal?: AbortSignal): Promise<ComicProject>
  saveLayerImage(
    projectId: ComicProjectId, revision: number, panelId: ComicPanelId, layerId: ComicLayerId,
    file: File, signal?: AbortSignal,
  ): Promise<ComicProject>
  readImage(projectId: ComicProjectId, image: ComicImage, signal?: AbortSignal): Promise<Blob>
  exportProject(projectId: ComicProjectId, signal?: AbortSignal): Promise<Blob>
  importProject(file: File, signal?: AbortSignal): Promise<ComicProject>
}

/** Localized copy and commands for a single mounted workbench. */
export interface ComicWorkbenchProps {
  readonly t: Translate<ComicProductionKey>
  readonly api: ComicWorkbenchApi
}

type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
type Dimensions = Pick<Box, 'width' | 'height'>
type EditPanel = (edit: (panel: ComicPanel) => ComicPanel) => void
type ReadArtwork = (image: ComicImage, signal: AbortSignal) => Promise<Blob>

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function fitBox<T extends Box>(box: T, bounds: Dimensions): T {
  const x = clamp(box.x, 0, bounds.width - 1)
  const y = clamp(box.y, 0, bounds.height - 1)
  return { ...box, x, y, width: clamp(box.width, 1, bounds.width - x), height: clamp(box.height, 1, bounds.height - y) }
}

function freePanelBox(page: ComicPage): Box {
  const margin = Math.floor(Math.min(page.width, page.height) / 20)
  const width = Math.max(1, Math.floor((page.width - 3 * margin) / 2))
  const height = Math.max(1, Math.floor((page.height - 4 * margin) / 3))
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const box = fitBox({ x: margin + column * (width + margin), y: margin + row * (height + margin), width, height }, page)
      const overlaps = page.panels.some(panel => box.x < panel.x + panel.width && box.x + box.width > panel.x
        && box.y < panel.y + panel.height && box.y + box.height > panel.y)
      if (!overlaps) return box
    }
  }
  return fitBox({ x: margin, y: margin, width, height }, page)
}

function resizePanel(panel: ComicPanel, box: Box): ComicPanel {
  return {
    ...panel, ...box,
    bubbles: panel.bubbles.map(bubble => ({
      ...fitBox(bubble, box),
      tailX: bubble.tailX === undefined ? undefined : clamp(bubble.tailX, 0, box.width - 1),
      tailY: bubble.tailY === undefined ? undefined : clamp(bubble.tailY, 0, box.height - 1),
    })),
  }
}

function swap<T>(items: readonly T[], from: number, to: number): readonly T[] {
  const item = items[from]
  const other = items[to]
  return item === undefined || other === undefined ? items : items.map((value, index) => {
    if (index === from) return other
    if (index === to) return item
    return value
  })
}

function blankLayer(name: string): ComicLayer {
  return { id: randomUUID() as ComicLayerId, name, versions: [], imageId: null, visible: true }
}

function blankPanel(box: Box, name: string): ComicPanel {
  return { ...box, id: randomUUID() as ComicPanelId, description: '', notes: '', layers: [blankLayer(name)], bubbles: [] }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => { URL.revokeObjectURL(url) }, 0)
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return String(error)
}

function BoxFields(props: {
  readonly t: ComicWorkbenchProps['t']
  readonly box: Box
  readonly bounds: Dimensions
  readonly onChange: (box: Box) => void
}) {
  const { t, box, bounds, onChange } = props
  return <div className={css.geometry}>
    {(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>
      {t(`geometry.${key}`)}
      <input type="number" min={key === 'x' || key === 'y' ? 0 : 1} value={box[key]} onChange={(event) => {
        const value = event.currentTarget.valueAsNumber
        if (!Number.isFinite(value)) return
        if (key === 'x') onChange({ ...box, x: clamp(value, 0, bounds.width - box.width) })
        else if (key === 'y') onChange({ ...box, y: clamp(value, 0, bounds.height - box.height) })
        else onChange(fitBox({ ...box, [key]: value }, bounds))
      }} />
    </label>)}
  </div>
}

function BalloonEditor(props: {
  readonly t: ComicWorkbenchProps['t']
  readonly panel: ComicPanel
  readonly edit: EditPanel
}) {
  const { t, panel, edit } = props
  const add = () => { edit(value => ({ ...value, bubbles: [...value.bubbles, {
    ...fitBox({ x: Math.floor(value.width / 8), y: Math.floor(value.height / 8),
      width: Math.ceil(value.width * 0.48), height: Math.ceil(value.height * 0.19) }, value),
    id: randomUUID() as ComicBubbleId, text: '', speaker: '',
  }] })) }
  return <section className={css.inspectorSection}>
    <header><h3>{t('balloon.section')}</h3><button type="button" onClick={add} disabled={panel.bubbles.length >= 32}>{t('balloon.add')}</button></header>
    {panel.bubbles.map((bubble, index) => {
      const update = (patch: Partial<ComicBubble>) => { edit(value => ({
        ...value, bubbles: value.bubbles.map(item => item.id === bubble.id ? { ...item, ...patch } : item),
      })) }
      const hasTail = bubble.tailX !== undefined && bubble.tailY !== undefined
      return <fieldset key={bubble.id} className={css.detail}>
        <legend>{t('balloon.number', { number: index + 1 })}</legend>
        <label>{t('balloon.speaker')}<input value={bubble.speaker} onChange={(event) => { update({ speaker: event.currentTarget.value }) }} /></label>
        <label>{t('balloon.text')}<textarea rows={3} value={bubble.text} onChange={(event) => { update({ text: event.currentTarget.value }) }} /></label>
        <BoxFields t={t} box={bubble} bounds={panel} onChange={update} />
        <div className={css.geometry}>
          <label>{t('balloon.fontSize')}<input type="number" min={1} max={256} value={bubble.fontSize ?? ''} onChange={(event) => {
            const value = event.currentTarget.valueAsNumber
            update({ fontSize: Number.isFinite(value) ? clamp(value, 1, 256) : undefined })
          }} /></label>
          <label className={css.check}><input type="checkbox" checked={hasTail} onChange={(event) => { update(event.currentTarget.checked ? {
            tailX: clamp(bubble.x + bubble.width / 2, 0, panel.width - 1),
            tailY: clamp(bubble.y + bubble.height + 36, 0, panel.height - 1),
          } : { tailX: undefined, tailY: undefined }) }} />{t('balloon.tail')}</label>
          {hasTail && <>
            <label>{t('balloon.tailX')}<input type="number" min={0} max={panel.width - 1} value={bubble.tailX} onChange={(event) => {
              const value = event.currentTarget.valueAsNumber
              if (Number.isFinite(value)) update({ tailX: clamp(value, 0, panel.width - 1) })
            }} /></label>
            <label>{t('balloon.tailY')}<input type="number" min={0} max={panel.height - 1} value={bubble.tailY} onChange={(event) => {
              const value = event.currentTarget.valueAsNumber
              if (Number.isFinite(value)) update({ tailY: clamp(value, 0, panel.height - 1) })
            }} /></label>
          </>}
        </div>
        <div className={css.actions}>
          <button type="button" disabled={index === 0} onClick={() => { edit(value => ({ ...value, bubbles: swap(value.bubbles, index, index - 1) })) }}>{t('panel.earlier')}</button>
          <button type="button" disabled={index === panel.bubbles.length - 1} onClick={() => { edit(value => ({ ...value, bubbles: swap(value.bubbles, index, index + 1) })) }}>{t('panel.later')}</button>
          <button type="button" onClick={() => { edit(value => ({ ...value, bubbles: value.bubbles.filter(item => item.id !== bubble.id) })) }}>{t('balloon.remove')}</button>
        </div>
      </fieldset>
    })}
  </section>
}

function LayerEditor(props: {
  readonly t: ComicWorkbenchProps['t']
  readonly panel: ComicPanel
  readonly edit: EditPanel
  readonly dirty: boolean
  readonly onImport: (layer: ComicLayer, file: File) => void
  readonly onExport: (layer: ComicLayer, image: ComicImage) => void
}) {
  const { t, panel, edit, dirty, onImport, onExport } = props
  const [layerId, setLayerId] = useState<ComicLayerId | null>(null)
  const layer = panel.layers.find(item => item.id === layerId) ?? panel.layers[0]
  const image = layer?.versions.find(item => item.id === layer.imageId)
  const update = (patch: Partial<ComicLayer>) => { edit(value => ({
    ...value, layers: value.layers.map(item => item.id === layer?.id ? { ...item, ...patch } : item),
  })) }
  return <section className={css.inspectorSection}>
    <header><h3>{t('layer.section')}</h3><button type="button" disabled={panel.layers.length >= 32} onClick={() => {
      const added = blankLayer(t('layer.number', { number: panel.layers.length + 1 }))
      setLayerId(added.id)
      edit(value => ({ ...value, layers: [...value.layers, added] }))
    }}>{t('layer.add')}</button></header>
    {layer !== undefined && <div className={css.detail}>
      <label>{t('layer.section')}<select value={layer.id} onChange={(event) => { setLayerId(event.currentTarget.value as ComicLayerId) }}>
        {panel.layers.map((item, index) => <option key={item.id} value={item.id}>{item.name || t('layer.number', { number: index + 1 })}</option>)}
      </select></label>
      <label>{t('layer.title')}<input value={layer.name} onChange={(event) => { update({ name: event.currentTarget.value }) }} /></label>
      <label className={css.check}><input type="checkbox" checked={layer.visible} onChange={(event) => { update({ visible: event.currentTarget.checked }) }} />{t('layer.show')}</label>
      <label>{t('layer.version')}<select value={layer.imageId ?? ''} onChange={(event) => { update({ imageId: (event.currentTarget.value || null) as ComicImageId | null }) }}>
        <option value="">{t('layer.noArt')}</option>
        {layer.versions.map((item, index) => <option key={item.id} value={item.id}>{t('layer.revision', { number: index + 1 })}</option>)}
      </select></label>
      {image !== undefined && <output className={css.muted}>{t('layer.imageSize', { width: image.width, height: image.height })}</output>}
      <label>{t('layer.import')}<input type="file" accept="image/png,.png" disabled={dirty} onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        if (file !== undefined) onImport(layer, file)
        event.currentTarget.value = ''
      }} /></label>
      {dirty && <span className={css.muted}>{t('layer.saveFirst')}</span>}
      <div className={css.actions}>
        <button type="button" disabled={image === undefined} onClick={() => { if (image !== undefined) onExport(layer, image) }}>{t('layer.export')}</button>
      </div>
    </div>}
  </section>
}

function PageCanvas(props: {
  readonly t: ComicWorkbenchProps['t']
  readonly page: ComicPage
  readonly read: ReadArtwork
  readonly selected: ComicPanelId | undefined
  readonly onSelect: (id: ComicPanelId) => void
  readonly onMove: (id: ComicPanelId, x: number, y: number) => void
  readonly reading: boolean
  readonly actualSize: boolean
}) {
  const { t, page, read, selected, onSelect, onMove, reading, actualSize } = props
  const canvas = useRef<HTMLCanvasElement>(null)
  const [loaded, setLoaded] = useState<{ media: string; read: ReadArtwork; artwork: HTMLCanvasElement }>()
  const [failed, setFailed] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const [retry, setRetry] = useState(0)
  const media = JSON.stringify(pageArtwork(page))
  const requested = useMemo(() => JSON.parse(media) as ComicArtwork, [media])
  const drag = useRef<{
    id: ComicPanelId
    pointer: number
    x: number
    y: number
    left: number
    top: number
    scale: number
    moved: boolean
  } | null>(null)
  const [placement, setPlacement] = useState<{ id: ComicPanelId; x: number; y: number } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let composite: HTMLCanvasElement | undefined
    setFailed(false)
    setLoaded(undefined)
    void renderArtwork(requested, image => read(image, controller.signal), controller.signal).then((artwork) => {
      if (controller.signal.aborted) artwork.width = 0
      else { composite = artwork; setLoaded({ media, read, artwork }) }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => {
      controller.abort()
      if (composite !== undefined) composite.width = 0
    }
  }, [media, requested, read, retry])

  useEffect(() => {
    let active = true
    void document.fonts.ready.then(() => {
      const artwork = loaded?.media === media && loaded.read === read && loaded.artwork.width > 0 ? loaded.artwork : undefined
      if (active && canvas.current !== null) setOverflow(drawComicPage(canvas.current, page, artwork))
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [page, media, read, loaded])

  const begin = (event: PointerEvent<HTMLButtonElement>, panel: ComicPanel) => {
    if (event.button !== 0 || canvas.current === null) return
    const scale = canvas.current.getBoundingClientRect().width / page.width
    if (!(scale > 0)) return
    onSelect(panel.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      id: panel.id, pointer: event.pointerId, x: event.clientX, y: event.clientY,
      left: panel.x, top: panel.y, scale, moved: false,
    }
  }
  const move = (event: PointerEvent<HTMLButtonElement>, panel: ComicPanel) => {
    const origin = drag.current
    if (origin === null || origin.pointer !== event.pointerId) return
    const dx = Math.round((event.clientX - origin.x) / origin.scale)
    const dy = Math.round((event.clientY - origin.y) / origin.scale)
    if (dx !== 0 || dy !== 0) origin.moved = true
    if (origin.moved) setPlacement({
      id: origin.id,
      x: clamp(origin.left + dx, 0, page.width - panel.width),
      y: clamp(origin.top + dy, 0, page.height - panel.height),
    })
  }
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    const origin = drag.current
    if (origin !== null && event.pointerId === origin.pointer) {
      const dx = Math.round((event.clientX - origin.x) / origin.scale)
      const dy = Math.round((event.clientY - origin.y) / origin.scale)
      if (dx !== 0 || dy !== 0) onMove(origin.id, origin.left + dx, origin.top + dy)
    }
    drag.current = null
    setPlacement(null)
  }

  return <>
    {failed && <div role="status" className={css.notice}>{t('page.canvasFailed')} <button type="button" onClick={() => { setRetry(value => value + 1) }}>{t('page.retry')}</button></div>}
    {!failed && loaded === undefined && requested.panels.some(panel => panel.images.length > 0)
      && <p role="status" className={css.notice}>{t('page.loadingArt')}</p>}
    {overflow && <p role="status" className={css.notice}>{t('balloon.overflow')}</p>}
    <div className={css.paper} style={{ width: actualSize ? page.width : undefined, maxWidth: actualSize ? 'none' : undefined,
      aspectRatio: `${page.width} / ${page.height}` }}>
      <canvas ref={canvas} width={page.width} height={page.height} aria-label={page.title || t('pages.title')} />
      {!reading && page.panels.map((panel, index) => <button type="button" key={panel.id} className={css.panelOverlay}
        aria-label={t('panel.number', { number: index + 1 })} aria-pressed={selected === panel.id}
        style={{ left: `${(placement?.id === panel.id ? placement.x : panel.x) / page.width * 100}%`,
          top: `${(placement?.id === panel.id ? placement.y : panel.y) / page.height * 100}%`,
          width: `${panel.width / page.width * 100}%`, height: `${panel.height / page.height * 100}%` }}
        onClick={() => { onSelect(panel.id) }}
        onPointerDown={(event) => { begin(event, panel) }} onPointerMove={(event) => { move(event, panel) }}
        onPointerUp={finish} onLostPointerCapture={() => { drag.current = null; setPlacement(null) }}>
        <span>{index + 1}</span>
      </button>)}
    </div>
  </>
}

/**
 * Open a workspace manuscript and keep its draft until a commit succeeds.
 * @param props - Localized copy and authenticated project commands for the current Session.
 * @returns The project picker or the selected manuscript's workbench.
 */
export function ComicWorkbench({ t, api }: ComicWorkbenchProps) {
  const [projects, setProjects] = useState<readonly ComicProjectSummary[] | null>(null)
  const [project, setProject] = useState<ComicProject | null>(null)
  const [draft, setDraft] = useState<{ readonly revision: number; readonly value: ComicDraft } | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [pageId, setPageId] = useState<ComicPageId | null>(null)
  const [panelId, setPanelId] = useState<ComicPanelId | null>(null)
  const [reading, setReading] = useState(false)
  const [actualSize, setActualSize] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void api.list(controller.signal).then((value) => {
      if (!controller.signal.aborted) setProjects(value)
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) { setProjects([]); setError(errorText(failure)) }
    })
    return () => { controller.abort(); pending.current?.abort(); pending.current = null }
  }, [api])

  const run = (task: (signal: AbortSignal) => Promise<void>): void => {
    if (pending.current !== null) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError(null)
    void task(controller.signal).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(errorText(failure))
    }).finally(() => {
      if (pending.current === controller) { pending.current = null; setBusy(false) }
    })
  }

  const remember = (value: ComicProject): void => {
    setProject(value)
    setDraft(null)
    setProjects((items) => {
      const summary: ComicProjectSummary = { id: value.id, title: value.title, revision: value.revision }
      if (items?.some(item => item.id === value.id)) return items.map(item => item.id === value.id ? summary : item)
      return [summary, ...(items ?? [])]
    })
  }
  const open = (task: (signal: AbortSignal) => Promise<ComicProject>) => { run(async (signal) => {
    const value = await task(signal)
    if (signal.aborted) return
    remember(value)
    setNewTitle('')
    setPageId(null)
    setPanelId(null)
    setReading(false)
    setActualSize(false)
  }) }

  const projectId = project?.id
  const read = useCallback<ReadArtwork>((image, signal) => {
    if (projectId === undefined) return Promise.reject(new Error('No comic project is open.'))
    return api.readImage(projectId, image, signal)
  }, [api, projectId])

  const input = draft?.value ?? project
  const page = input?.pages.find(item => item.id === pageId) ?? input?.pages[0]
  const panel = page?.panels.find(item => item.id === panelId) ?? page?.panels[0]
  const dirty = draft !== null
  const stale = dirty && draft.revision !== project?.revision
  const editDraft = (edit: (current: ComicDraft) => ComicDraft): void => {
    if (project === null || busy) return
    setDraft(current => ({
      revision: current?.revision ?? project.revision,
      value: edit(current?.value ?? { title: project.title, pages: project.pages }),
    }))
  }
  const editPage = (edit: (current: ComicPage) => ComicPage): void => {
    if (page !== undefined) editDraft(current => ({
      ...current, pages: current.pages.map(item => item.id === page.id ? edit(item) : item),
    }))
  }
  const editPanel: EditPanel = (edit) => {
    if (panel !== undefined) editPage(current => ({
      ...current, panels: current.panels.map(item => item.id === panel.id ? edit(item) : item),
    }))
  }
  const addPanel = () => {
    if (page === undefined) return
    const added = blankPanel(freePanelBox(page), t('layer.default'))
    editPage(current => ({ ...current, panels: [...current.panels, added] }))
    setPanelId(added.id)
  }
  const splitPanel = () => {
    if (page === undefined || panel === undefined || panel.height < 3) return
    const margin = Math.min(64, Math.floor(Math.min(page.width, page.height) / 10))
    const gutter = Math.min(margin, Math.floor(panel.height / 4))
    const split = Math.floor((panel.height - gutter) / 2)
    const added = blankPanel({
      x: panel.x, y: panel.y + split + gutter, width: panel.width, height: panel.height - split - gutter,
    }, t('layer.default'))
    editPage(current => ({ ...current, panels: current.panels.flatMap(item => item.id === panel.id
      ? [resizePanel(item, { ...item, height: split }), added] : [item]) }))
    setPanelId(added.id)
  }

  if (project === null || input === null) return <div className={css.workspace}>
    <div className={css.library}>
      <h2>{t('project.library')}</h2><p className={css.muted}>{t('project.empty')}</p>
      {error !== null && <p role="alert" className={css.notice}>{error}</p>}
      {projects === null ? <p role="status">{t('project.loading')}</p> : <>
        <form className={css.create} onSubmit={(event) => {
          event.preventDefault()
          if (newTitle.trim()) open(signal => api.create(newTitle.trim(), signal))
        }}>
          <label>{t('project.title')}<input value={newTitle} maxLength={200} onChange={(event) => { setNewTitle(event.currentTarget.value) }} /></label>
          <button type="submit" className={css.primary} disabled={busy || !newTitle.trim()}>{t('project.create')}</button>
        </form>
        <label className={css.import}>{t('project.import')}<input type="file" disabled={busy} accept=".json,application/json" onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file !== undefined) open(signal => api.importProject(file, signal))
          event.currentTarget.value = ''
        }} /></label>
        <ul className={css.projects}>{projects.map(item => <li key={item.id}>
          <button type="button" disabled={busy} onClick={() => { open(signal => api.open(item.id, signal)) }}>{item.title}</button>
        </li>)}</ul>
      </>}
      {busy && <p role="status">{t('project.working')}</p>}
    </div>
  </div>

  const pageIndex = input.pages.findIndex(item => item.id === page?.id)
  const panelIndex = page?.panels.findIndex(item => item.id === panel?.id) ?? -1
  const save = () => { run(async (signal) => {
    if (draft === null || stale) return
    const value = await api.save(project.id, draft.revision, { title: input.title.trim(), pages: input.pages }, signal)
    if (!signal.aborted) remember(value)
  }) }
  const exportPage = () => {
    if (page === undefined) return
    run(async (signal) => {
      await document.fonts.ready
      const artwork = await renderArtwork(pageArtwork(page), image => read(image, signal), signal)
      try {
        const target = document.createElement('canvas')
        drawComicPage(target, page, artwork)
        const png = await canvasPng(target)
        if (!signal.aborted) download(png, `page-${pageIndex + 1}.png`)
      } finally {
        artwork.width = 0
      }
    })
  }

  return <div className={css.workspace}>
    <header className={css.toolbar}>
      <button type="button" disabled={dirty || busy} onClick={() => { setProject(null); setError(null) }}>{t('project.back')}</button>
      <input className={css.titleInput} aria-label={t('project.title')} value={input.title} maxLength={200} disabled={busy}
        onChange={(event) => { const title = event.currentTarget.value; editDraft(value => ({ ...value, title })) }} />
      <span role="status" className={css.muted}>{busy ? t('project.working') : dirty ? t('project.dirty') : t('project.saved')}</span>
      {dirty && <button type="button" disabled={busy} onClick={() => { setDraft(null); setError(null) }}>{t('project.discard')}</button>}
      <button type="button" className={css.primary} disabled={busy || !dirty || stale || !input.title.trim()} onClick={save}>{t('project.save')}</button>
      <button type="button" disabled={dirty || busy} onClick={() => { run(async (signal) => {
        const file = await api.exportProject(project.id, signal)
        if (!signal.aborted) download(file, `${project.title.replace(/[<>:"/\\|?*]/gu, '-')}.dsh-comic.json`)
      }) }}>{t('project.export')}</button>
    </header>
    {error !== null && <div role="alert" className={css.notice}>{error} <button type="button" disabled={busy} onClick={() => { run(async (signal) => {
      const latest = await api.open(project.id, signal)
      if (signal.aborted) return
      if (dirty) setProject(latest)
      else remember(latest)
    }) }}>{t('project.refresh')}</button></div>}
    {stale && <p role="status" className={css.notice}>{t('project.stale')}</p>}
    <div className={css.body}>
      <nav className={css.pages} aria-label={t('pages.title')}>
        <h3>{t('pages.title')}</h3>
        <ol>{input.pages.map((item, index) => <li key={item.id}>
          <button type="button" aria-current={item.id === page?.id ? 'page' : undefined} onClick={() => { setPageId(item.id); setPanelId(null) }}>
            <span>{t('page.number', { number: index + 1 })}</span>{item.title && <small>{item.title}</small>}
          </button>
        </li>)}</ol>
        {!reading && <button type="button" disabled={busy || input.pages.length >= 32} onClick={() => {
          const width = page?.width ?? 1200
          const height = page?.height ?? 1600
          const margin = Math.min(64, Math.floor(Math.min(width, height) / 10))
          const added: ComicPage = { id: randomUUID() as ComicPageId, width, height, title: '', panels: [
            blankPanel({ x: margin, y: margin, width: width - margin * 2, height: height - margin * 2 }, t('layer.default')),
          ] }
          editDraft(value => ({ ...value, pages: [...value.pages, added] }))
          setPageId(added.id)
          setPanelId(null)
        }}>{t('page.add')}</button>}
      </nav>
      <main className={css.stage}>
        <div className={css.stageToolbar}>
          {page !== undefined && <strong>{t('page.number', { number: pageIndex + 1 })}</strong>}
          <button type="button" onClick={() => { setReading(value => !value); setActualSize(false) }}>{reading ? t('page.edit') : t('page.preview')}</button>
          {reading && <button type="button" aria-pressed={actualSize} onClick={() => { setActualSize(value => !value) }}>{t('page.actualSize')}</button>}
          <button type="button" disabled={busy || dirty || page === undefined} onClick={exportPage}>{t('page.export')}</button>
        </div>
        <div className={css.stageScroll}>
          {page !== undefined && <PageCanvas key={page.id} t={t} page={page} read={read}
            selected={panel?.id} reading={reading} actualSize={actualSize}
            onSelect={setPanelId} onMove={(id, x, y) => { editPage(current => ({ ...current, panels: current.panels.map((item) => {
              if (item.id !== id) return item
              return { ...item, x: clamp(x, 0, current.width - item.width), y: clamp(y, 0, current.height - item.height) }
            }) })) }} />}
        </div>
      </main>
      {!reading && page !== undefined && <fieldset className={css.inspector} disabled={busy}>
        <label>{t('page.title')}<input value={page.title} onChange={(event) => { const title = event.currentTarget.value; editPage(value => ({ ...value, title })) }} /></label>
        <section className={css.inspectorSection}>
          <header><h3>{t('panel.layout')}</h3><button type="button" disabled={page.panels.length >= 32} onClick={addPanel}>{t('panel.add')}</button></header>
          {panel === undefined ? <p className={css.muted}>{t('page.noPanels')}</p> : <>
            <label>{t('panel.selection')}<select value={panel.id} onChange={(event) => { setPanelId(event.currentTarget.value as ComicPanelId) }}>
              {page.panels.map((item, index) => <option key={item.id} value={item.id}>{t('panel.number', { number: index + 1 })}</option>)}
            </select></label>
            <BoxFields t={t} box={panel} bounds={page} onChange={(box) => { editPanel(value => resizePanel(value, box)) }} />
            <div className={css.actions}>
              <button type="button" disabled={panel.height < 3 || page.panels.length >= 32} onClick={splitPanel}>{t('panel.split')}</button>
              <button type="button" disabled={panelIndex <= 0} onClick={() => { editPage(value => ({ ...value, panels: swap(value.panels, panelIndex, panelIndex - 1) })) }}>{t('panel.earlier')}</button>
              <button type="button" disabled={panelIndex >= page.panels.length - 1} onClick={() => { editPage(value => ({ ...value, panels: swap(value.panels, panelIndex, panelIndex + 1) })) }}>{t('panel.later')}</button>
              <button type="button" onClick={() => { editPage(value => ({ ...value, panels: value.panels.filter(item => item.id !== panel.id) })) }}>{t('panel.remove')}</button>
            </div>
            <label>{t('panel.description')}<textarea rows={3} value={panel.description} onChange={(event) => { const description = event.currentTarget.value; editPanel(value => ({ ...value, description })) }} /></label>
            <label>{t('review.title')}<textarea rows={2} value={panel.notes} onChange={(event) => { const notes = event.currentTarget.value; editPanel(value => ({ ...value, notes })) }} /></label>
          </>}
        </section>
        {panel !== undefined && <>
          <LayerEditor key={panel.id} t={t} panel={panel} edit={editPanel} dirty={dirty}
            onImport={(layer, file) => { run(async (signal) => {
              const value = await api.saveLayerImage(project.id, project.revision, panel.id, layer.id, file, signal)
              if (!signal.aborted) remember(value)
            }) }}
            onExport={(layer, image) => { run(async (signal) => {
              const png = await read(image, signal)
              if (!signal.aborted) download(png, `${(layer.name || 'artwork').replace(/[<>:"/\\|?*]/gu, '-')}.png`)
            }) }} />
          <BalloonEditor t={t} panel={panel} edit={editPanel} />
        </>}
      </fieldset>}
    </div>
  </div>
}
