/** Interactive projection of saved production facts with session-local navigation. */
import { createContext, useContext, useMemo, useState } from 'react'
import { Background, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { VideoGenerationTarget, VideoProject, VideoProjectInput, VideoShotId, VideoShotInput } from '@deepseek-ai/dsh-video-production/types'
import type { VideoProductionViewProps } from './VideoProductionView.tsx'
import type { ProductionMediaRef, ProductionSnapshot } from './controller.ts'
import type { VideoCanvasState } from './canvas-store.ts'
import { connectWorkflowNodes, disconnectWorkflowEdge, projectWorkflowGraph, type WorkflowNodeData, type WorkflowNodeKind } from './workflow-graph.ts'
import { acceptsShot } from './generation-target.ts'
import { ReferenceEdge } from './ReferenceEdge.tsx'
import css from './VideoProductionView.module.css'

interface CanvasProps {
  project: VideoProject
  state: ProductionSnapshot
  canvas: VideoCanvasState
  actions: VideoProductionViewProps['actions']
  t: VideoProductionViewProps['t']
  dirty: boolean
  target: VideoGenerationTarget | null
  edit: (input: VideoProjectInput) => void
  editShot: (id: VideoShotId, fields: Partial<VideoShotInput>) => void
  generate: VideoProductionViewProps['generate']
  loadMedia: VideoProductionViewProps['loadMedia']
}
type FlowNode = Node<{ fact: WorkflowNodeData }, WorkflowNodeKind>
const CanvasContext = createContext<CanvasProps | null>(null)
function useCanvas(): CanvasProps {
  const value = useContext(CanvasContext)
  if (value === null) throw new Error('Workflow node requires its canvas provider')
  return value
}
function Port({ id, type, label, fixed = false, top }: { id: string; type: 'source' | 'target'; label: string; fixed?: boolean; top: number }) {
  const { state } = useCanvas()
  return <><Handle id={id} type={type} position={type === 'source' ? Position.Right : Position.Left} isConnectable={!fixed && state.operation === null} style={{ top }} aria-label={label} /><span className={type === 'source' ? css.portRight : css.portLeft} style={{ top: top - 8 }}>{label}</span></>
}
function VideoPreview({ media, title, film = false }: { media: ProductionMediaRef; title: string; film?: boolean }) {
  const { state, loadMedia, t } = useCanvas()
  const url = state.media[media.attachmentId]
  return <div className={`${css.nodeMedia} nodrag nowheel`}>
    {url === undefined ? <button type="button" disabled={state.mediaLoading.includes(media.attachmentId)} onClick={() => { loadMedia(media) }}>{t(state.mediaLoading.includes(media.attachmentId) ? 'media.loading' : 'media.load')}</button> : <><video controls preload="metadata" src={url} aria-label={title} /><a href={url} download={media.name ?? `${media.attachmentId}.${media.mediaType === 'video/webm' ? 'webm' : 'mp4'}`}>{t(film ? 'export.download' : 'shot.download')}</a></>}
    {state.mediaErrors[media.attachmentId] === undefined ? null : <p role="alert">{state.mediaErrors[media.attachmentId]}</p>}
  </div>
}
function WorkflowCard({ id, data, selected }: NodeProps<FlowNode>) {
  const { t, state, dirty, editShot, generate, loadMedia, project, target } = useCanvas()
  const fact = data.fact
  const exportStatus = state.operation?.kind === 'export' ? 'running' : fact.kind === 'film' ? fact.latestAttempt?.status : undefined
  const busy = state.operation !== null
  const title = fact.kind === 'reference' ? fact.asset.name : 'shot' in fact ? fact.shot.title : t(`workflow.${fact.kind}`)
  const running = 'shot' in fact && ((state.operation?.kind === 'generate' && state.operation.shotId === fact.shot.id) || (state.operation?.kind === 'batch' && state.operation.currentShotId === fact.shot.id))
  return <article className={`${css.workflowNode} ${selected ? css.selected : ''}`} data-workflow-kind={fact.kind} data-workflow-node-id={id}>
    <header className={css.nodeHeader}><span className={css.nodeIcon} data-kind={fact.kind}>{fact.kind === 'reference' ? '◈' : fact.kind === 'prompt' ? '≡' : fact.kind === 'generation' ? '✦' : fact.kind === 'assembly' ? '▤' : '▶'}</span><div><small>{t(`workflow.${fact.kind}`)}</small><strong>{title}</strong></div></header>
    {fact.kind === 'reference' ? <><div className={css.referenceImage}>{fact.asset.image !== undefined && state.media[fact.asset.image.attachmentId] !== undefined ? <img src={state.media[fact.asset.image.attachmentId]} alt={fact.asset.name} /> : <span>{t('workflow.noImage')}</span>}</div><footer>{t(fact.asset.kind === 'prop' ? 'asset.reference' : `asset.${fact.asset.kind}`)}</footer><Port id="image" type="source" fixed={fact.asset.image === undefined} label={t('workflow.image')} top={235} /></> : null}
    {fact.kind === 'prompt' ? <><div className="nodrag"><input aria-label={t('shot.title')} value={fact.shot.title} disabled={busy} onChange={(event) => { editShot(fact.shot.id, { title: event.target.value }) }} /><textarea aria-label={t('shot.prompt')} value={fact.shot.prompt} placeholder={t('shot.prompt')} disabled={busy} rows={5} onChange={(event) => { editShot(fact.shot.id, { prompt: event.target.value }) }} /></div><footer>{t('shot.seconds', { seconds: fact.shot.duration })}</footer><Port id="text" type="source" fixed label={t('workflow.text')} top={235} /></> : null}
    {fact.kind === 'generation' ? <><div className={css.generationCore}><span>✦</span><strong title={target?.title}>{running ? t('shot.generating') : target?.title ?? t('generation.choose')}</strong><small>{t('shot.summary', { seconds: fact.shot.duration, ratio: fact.shot.aspectRatio, resolution: fact.shot.resolution })}</small></div><button className={`${css.generateButton} nodrag`} type="button" disabled={busy || dirty || target === null || !acceptsShot(target, fact.shot)} title={target !== null && !acceptsShot(target, fact.shot) ? t('generation.unsupported') : undefined} onClick={() => { generate(fact.shot.id) }}>{t(fact.shot.versions.length === 0 ? 'shot.generate' : 'shot.retry')}</button><Port id="prompt" type="target" fixed label={t('workflow.text')} top={208} /><Port id="references" type="target" label={t('workflow.references')} top={240} /><Port id="result" type="source" fixed label={t('workflow.video')} top={240} /></> : null}
    {fact.kind === 'video-result' ? <>{fact.version?.attachment === undefined ? <div className={css.nodeMedia}>{t(fact.version === null ? 'shot.noVideo' : `status.${fact.version.status}`)}</div> : <VideoPreview media={fact.version.attachment} title={t('shot.preview', { title: fact.shot.title })} />}<div className={css.nodeBadges}>{fact.version === null ? null : <span>{t('shot.version', { number: fact.shot.versions.findIndex(version => version.id === fact.version?.id) + 1 })}</span>}{fact.selected ? <span>{t('workflow.adopted')}</span> : null}{fact.stale ? <span data-warning>{t('workflow.stale')}</span> : null}</div>{fact.version === null ? null : <details className="nodrag"><summary>{t('workflow.frozen')}</summary><p>{fact.version.prompt}</p><p>{fact.version.generatorTitle ?? fact.version.generator ?? t('generation.unrecorded')}{fact.version.model === undefined ? null : ` · ${fact.version.model}`}{fact.version.generatorRevision === undefined ? null : <small> · {fact.version.generatorRevision}</small>}</p><small>{t('shot.summary', { seconds: fact.version.duration, ratio: fact.version.aspectRatio, resolution: fact.version.resolution })}</small><div className={css.frozenReferences}>{fact.version.referenceImages.map((image, index) => <button type="button" key={image.attachmentId} onClick={() => { loadMedia(image) }} aria-label={t('workflow.referenceNumber', { number: index + 1 })}>{state.media[image.attachmentId] === undefined ? <span>{index + 1}</span> : <img src={state.media[image.attachmentId]} alt={t('workflow.referenceNumber', { number: index + 1 })} />}</button>)}</div></details>}<p className={css.nodeError}>{fact.version?.error}</p><Port id="generation" type="target" fixed label={t('workflow.fixed')} top={250} /><Port id="video" type="source" fixed={fact.version?.status !== 'completed' || fact.version.attachment === undefined} label={t('workflow.video')} top={250} /></> : null}
    {fact.kind === 'assembly' ? <><ol className={css.assemblyList}>{fact.inputs.map(input => <li key={input.shotId}><span>{String(input.index + 1).padStart(2, '0')}</span><strong>{input.title}</strong><i data-ready={input.ready}>{input.ready ? '●' : '○'}</i></li>)}</ol><footer>{t(fact.ready ? 'workflow.ready' : 'workflow.missing')}</footer><Port id="clips" type="target" label={t('workflow.clips')} top={240} /><Port id="film" type="source" fixed label={t('workflow.film')} top={240} /></> : null}
    {fact.kind === 'film' ? <>{exportStatus === undefined ? null : <p className={css.exportStatus} data-status={exportStatus}>{t('export.latestStatus', { status: t(`export.status.${exportStatus}`) })}</p>}{fact.film !== null && (state.operation?.kind === 'export' || fact.latestAttempt?.id !== fact.film.id) ? <p className={css.stale}>{t('export.previousSuccess')}</p> : null}{fact.film?.attachment === undefined ? <div className={css.nodeMedia}>{t(state.operation?.kind === 'export' || fact.latestAttempt?.status === 'running' ? 'export.running' : fact.ready ? 'export.notAssembled' : 'export.requiresVideo')}</div> : <VideoPreview media={fact.film.attachment} film title={t('export.preview')} />}{fact.stale ? <p className={css.stale}>{t('workflow.filmStale')}</p> : null}<details className="nodrag"><summary>{t('workflow.inputs', { count: fact.film?.shotVersionIds.length ?? 0 })}</summary><ol>{fact.film?.shotVersionIds.map(versionId => <li key={versionId}>{project.shots.find(shot => shot.versions.some(version => version.id === versionId))?.title ?? t('workflow.missingSource')}<small> · {versionId}</small></li>)}</ol></details><Port id="assembly" type="target" fixed label={t('workflow.fixed')} top={240} /></> : null}
  </article>
}
const nodeTypes = { reference: WorkflowCard, prompt: WorkflowCard, generation: WorkflowCard, 'video-result': WorkflowCard, assembly: WorkflowCard, film: WorkflowCard }
const edgeTypes = { reference: ReferenceEdge }
function CanvasContents(props: CanvasProps) {
  const { project, canvas, actions, t, state } = props
  const [expanded, setExpanded] = useState<VideoShotId[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState(false)
  const flow = useReactFlow<FlowNode>()
  const graph = useMemo(() => projectWorkflowGraph(project, expanded), [project, expanded])
  const nodes: FlowNode[] = graph.nodes.map(node => ({ ...node, initialWidth: 272, initialHeight: 270, data: { fact: node.data }, position: canvas.positions[node.id] ?? node.position, selected: canvas.selectedNodeIds.includes(node.id), deletable: state.operation === null && node.deletable, ariaLabel: `${t(`workflow.${node.type}`)} ${'shot' in node.data ? node.data.shot.title : node.data.kind === 'reference' ? node.data.asset.name : ''}` }))
  const edges = graph.edges.map(edge => ({
    ...edge, type: edge.data.kind === 'reference' ? 'reference' : 'default', selected: canvas.selectedEdgeIds.includes(edge.id), animated: edge.data.kind === 'reference' && state.operation?.kind === 'generate' && state.operation.shotId === edge.data.shotId,
    label: edge.data.kind === 'reference' ? t('workflow.image')
      : edge.data.kind === 'selection' ? t('workflow.sequenceNumber', { number: edge.data.index + 1 }) : undefined,
    ariaLabel: t(edge.data.kind === 'reference' ? 'workflow.image'
      : edge.data.kind === 'selection' ? 'workflow.adopted' : 'workflow.fixed'),
    style: {
      stroke: edge.data.kind === 'reference' ? '#9b82ef' : edge.data.kind === 'selection' ? '#36b9a5' : '#8493a8',
      strokeWidth: canvas.selectedEdgeIds.includes(edge.id) ? 3 : 1.6,
    },
    deletable: state.operation === null && edge.deletable,
  }))
  const focusShotId = canvas.selectedShotId ?? project.shots[0]?.id
  const selectedFocus = nodes.filter(node => canvas.selectedNodeIds.includes(node.id))
  const initialFocus = project.shots.length > 2 || nodes.length > 12
    ? (selectedFocus.length > 0 ? selectedFocus
      : nodes.filter(node => 'shot' in node.data.fact && node.data.fact.shot.id === focusShotId)).map(node => ({ id: node.id }))
    : undefined
  const applyEdit = (result: ReturnType<typeof connectWorkflowNodes>) => { setError(result.kind === 'rejected'); if (result.kind === 'updated') props.edit(result.input) }
  const focusSearch = (value: string) => { setQuery(value); const match = nodes.find(node => node.ariaLabel?.toLocaleLowerCase().includes(value.toLocaleLowerCase())); if (value.trim() && match !== undefined) { actions.selectNodes([match.id]); if ('shot' in match.data.fact) actions.select(match.data.fact.shot.id); void flow.fitView({ nodes: [{ id: match.id }], duration: 250, maxZoom: 1 }) } }
  return <CanvasContext.Provider value={props}><div className={css.flowShell}>
    <div className={css.canvasToolbar}><h3>{t('canvas.title')}</h3><input aria-label={t('workflow.search')} placeholder={t('workflow.search')} value={query} onChange={(event) => { focusSearch(event.target.value) }} /><button type="button" disabled={canvas.selectedShotId === null} onClick={() => { const id = project.shots.find(shot => shot.id === canvas.selectedShotId)?.id; if (id !== undefined) setExpanded(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]) }}>{t('workflow.history')}</button><button type="button" onClick={() => { actions.resetLayout() }}>{t('canvas.arrange')}</button><button type="button" onClick={() => { void flow.fitView({ duration: 250, padding: 0.04 }) }}>{t('workflow.fit')}</button></div>
    <div className={css.stages}><span>{t('workflow.stage1')}</span><span>{t('workflow.stage2')}</span><span>{t('workflow.stage3')}</span></div>
    {error ? <p role="alert" className={css.error}>{t('workflow.invalid')}</p> : null}
    <div className={css.flowArea}><ReactFlow<FlowNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView={canvas.viewport === null} fitViewOptions={{ minZoom: 0.7, maxZoom: 1, padding: 0.04, ...initialFocus === undefined ? {} : { nodes: initialFocus } }} defaultViewport={canvas.viewport ?? { x: 0, y: 0, zoom: 0.65 }} minZoom={0.2} maxZoom={1.5} selectionOnDrag panOnDrag={[1, 2]} connectOnClick nodesConnectable={state.operation === null} deleteKeyCode={['Backspace', 'Delete']} onMoveEnd={(_event, viewport) => { actions.viewport(viewport) }}
      onNodesChange={(changes) => { for (const change of changes) { if (change.type === 'position' && change.position !== undefined) actions.move(change.id, change.position) } const selection = changes.filter(change => change.type === 'select'); if (selection.length > 0) { const ids = new Set(canvas.selectedNodeIds); for (const change of selection) { if (change.selected) ids.add(change.id); else ids.delete(change.id) } actions.selectNodes([...ids]) } }}
      onPaneClick={() => { actions.selectNodes([]); actions.select(null); actions.selectEdges([]) }}
      onNodeClick={(_event, node) => { if ('shot' in node.data.fact) actions.select(node.data.fact.shot.id); else actions.select(null) }}
      onNodeDoubleClick={(_event, node) => { if ('shot' in node.data.fact) { const id = node.data.fact.shot.id; setExpanded(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]) } }}
      onConnect={(connection) => { applyEdit(connectWorkflowNodes(project, graph, connection)) }}
      onEdgesChange={(changes) => { const ids = new Set(canvas.selectedEdgeIds); for (const change of changes) { if (change.type === 'select') { if (change.selected) ids.add(change.id); else ids.delete(change.id) } } actions.selectEdges([...ids]) }}
      onDelete={({ nodes: deletedNodes, edges: deletedEdges }) => {
        let current = project
        for (const edge of deletedEdges) {
          const original = graph.edges.find(item => item.id === edge.id)
          if (original === undefined || !original.deletable) continue
          const result = disconnectWorkflowEdge(current, original)
          if (result.kind === 'updated') current = { ...current, ...result.input, shots: result.input.shots.map(shot => ({ ...shot, versions: current.shots.find(item => item.id === shot.id)?.versions ?? [] })) }
        }
        const shotIds = new Set(deletedNodes.flatMap(node => node.data.fact.kind === 'prompt' ? [node.data.fact.shot.id] : []))
        const assetIds = new Set(deletedNodes.flatMap(node => node.data.fact.kind === 'reference' ? [node.data.fact.asset.id] : []))
        props.edit({
          revision: current.revision, title: current.title, assets: current.assets.filter(asset => !assetIds.has(asset.id)),
          shots: current.shots.filter(shot => !shotIds.has(shot.id)).map(({ versions: _versions, ...shot }) => ({
            ...shot, assetIds: shot.assetIds.filter(id => !assetIds.has(id)),
          })),
        })
      }}
      ariaLabelConfig={{ 'node.a11yDescription.default': t('workflow.nodeDescription'), 'node.a11yDescription.keyboardDisabled': t('workflow.nodeDescription'), 'edge.a11yDescription.default': t('workflow.edgeDescription'), 'controls.zoomIn.ariaLabel': t('canvas.zoomIn'), 'controls.zoomOut.ariaLabel': t('canvas.zoomOut'), 'controls.fitView.ariaLabel': t('workflow.fit'), 'minimap.ariaLabel': t('workflow.minimap'), 'handle.ariaLabel': t('workflow.connectHint'), 'controls.ariaLabel': t('canvas.title'), 'controls.interactive.ariaLabel': t('workflow.selection'), 'node.a11yDescription.ariaLiveMessage': ({ x, y }) => t('workflow.position', { x, y }) }}>
      <Background gap={24} size={1} /><MiniMap pannable zoomable nodeColor={node => node.type === 'reference' ? '#9b82ef' : node.type === 'film' ? '#36b9a5' : '#8d9bb0'} />
    </ReactFlow><div className={css.zoomControls}><button type="button" aria-label={t('canvas.zoomOut')} onClick={() => { void flow.zoomOut() }}>−</button><span>{t('canvas.zoomPercent', { value: Math.round(canvas.zoom * 100) })}</span><button type="button" aria-label={t('canvas.zoomIn')} onClick={() => { void flow.zoomIn() }}>+</button></div></div>
    <p className={css.connectionHint}>{t('workflow.connectHint')}</p>
  </div></CanvasContext.Provider>
}
/**
 * Render editable connections without persisting a second execution graph.
 * @param props - project facts, localized copy and authorized project actions.
 * @returns the navigable workflow canvas.
 */
export function WorkflowCanvas(props: CanvasProps) { return <ReactFlowProvider><CanvasContents {...props} /></ReactFlowProvider> }
