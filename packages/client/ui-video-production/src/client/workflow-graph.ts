/** Pure projection between persisted production records and editable workflow connections. */

import type {
  VideoAsset, VideoAssetId, VideoExport, VideoProject, VideoProjectInput,
  VideoShot, VideoShotId, VideoShotInput, VideoVersion, VideoVersionId,
} from '@deepseek-ai/dsh-video-production/types'
import type { CanvasPoint } from './canvas-store.ts'

/** Six production stages represented by the workspace. */
export type WorkflowNodeKind = 'reference' | 'prompt' | 'generation' | 'video-result' | 'assembly' | 'film'

/** One shot's exact adopted completed video. */
export interface AssemblyInput {
  readonly shotId: VideoShotId
  readonly title: string
  readonly index: number
  readonly versionId?: VideoVersionId
  readonly ready: boolean
}

/** Business facts carried by a workflow node; actions remain in the owning View. */
export type WorkflowNodeData =
  | { readonly kind: 'reference'; readonly asset: VideoAsset }
  | { readonly kind: 'prompt'; readonly shot: VideoShot }
  | { readonly kind: 'generation'; readonly shot: VideoShot }
  | {
    readonly kind: 'video-result'
    readonly shot: VideoShot
    readonly version: VideoVersion | null
    readonly selected: boolean
    readonly stale: boolean
  }
  | { readonly kind: 'assembly'; readonly inputs: readonly AssemblyInput[]; readonly ready: boolean }
  | {
    readonly kind: 'film'
    readonly ready: boolean
    readonly film: VideoExport | null
    readonly latestAttempt: VideoExport | null
    readonly stale: boolean
  }

/** Library-independent node supplied to the chosen canvas renderer. */
export interface WorkflowNode {
  readonly id: string
  readonly type: WorkflowNodeKind
  readonly position: CanvasPoint
  readonly data: WorkflowNodeData
  readonly deletable: boolean
}

/** An editable dependency or an immutable record of production ownership. */
export type WorkflowEdgeData =
  | { readonly kind: 'reference'; readonly assetId: VideoAssetId; readonly shotId: VideoShotId }
  | { readonly kind: 'selection'; readonly shotId: VideoShotId; readonly versionId: VideoVersionId; readonly index: number }
  | { readonly kind: 'structure'; readonly shotId: VideoShotId }
  | { readonly kind: 'render' }

/** A connection derived from project facts; there is no separate persisted edge list. */
export interface WorkflowEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly sourceHandle: string
  readonly targetHandle: string
  readonly data: WorkflowEdgeData
  readonly deletable: boolean
}

/** Complete diagram projection before applying Session-local viewing coordinates. */
export interface WorkflowGraph {
  readonly nodes: readonly WorkflowNode[]
  readonly edges: readonly WorkflowEdge[]
}

/** Canvas endpoints emitted by a user connection gesture. */
export interface WorkflowConnection {
  readonly source: string
  readonly target: string
  readonly sourceHandle: string | null
  readonly targetHandle: string | null
}

/** Stable rejection reason localized by the workspace. */
export type WorkflowRejection = 'unknown-node' | 'unsupported-connection' | 'reference-without-image' | 'video-not-ready' | 'fixed-connection'

/** Result of translating a gesture into the existing project update operation. */
export type WorkflowEdit =
  | { readonly kind: 'updated'; readonly input: VideoProjectInput }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rejected'; readonly reason: WorkflowRejection }

/**
 * Mint a stable View identity without interpreting domain ids as delimiters.
 * @param kind - represented production stage.
 * @param id - asset, shot, or project identity.
 * @param version - generated version identity for a video result.
 * @returns deterministic canvas identity.
 */
export function workflowNodeId(kind: WorkflowNodeKind, id: string, version?: string): string {
  return `${kind}:${encodeURIComponent(id)}${version === undefined ? '' : `:${encodeURIComponent(version)}`}`
}

function editable(project: VideoProject): VideoProjectInput {
  return {
    revision: project.revision, title: project.title, assets: project.assets,
    shots: project.shots.map(({ versions: _versions, ...shot }) => shot),
  }
}

function equalItems(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * Compare a recorded attempt with the shot's current generation inputs.
 * @param shot - current editable shot and retained attempts.
 * @param assets - current project's reusable references.
 * @param version - immutable request snapshot saved for one attempt.
 * @returns whether the attempt was generated from different inputs.
 */
export function versionInputsChanged(shot: VideoShot, assets: readonly VideoAsset[], version: VideoVersion): boolean {
  const imageIds = shot.assetIds.flatMap((id) => {
    const image = assets.find(asset => asset.id === id)?.image
    return image === undefined ? [] : [image.attachmentId]
  })
  return shot.prompt !== version.prompt || shot.duration !== version.duration
    || shot.aspectRatio !== version.aspectRatio || shot.resolution !== version.resolution
    || imageIds.length !== shot.assetIds.length
    || !equalItems(imageIds, version.referenceImages.map(image => image.attachmentId))
}

function edge(
  source: string, target: string, sourceHandle: string, targetHandle: string, data: WorkflowEdgeData,
): WorkflowEdge {
  return {
    id: JSON.stringify([source, sourceHandle, target, targetHandle]), source, target, sourceHandle, targetHandle,
    data, deletable: data.kind === 'reference' || data.kind === 'selection',
  }
}

/**
 * Derive real input dependencies, recorded generation outputs, and adopted film inputs.
 * @param project - authoritative or locally staged project with retained attempt records.
 * @param expandedShots - shots whose complete attempt histories are visible; others show adopted and latest attempts.
 * @returns stable node ids, stage layout, and connections derived only from project data.
 */
export function projectWorkflowGraph(project: VideoProject, expandedShots: readonly VideoShotId[] = []): WorkflowGraph {
  const nodes: WorkflowNode[] = []
  const edges: WorkflowEdge[] = []
  const expanded = new Set(expandedShots)
  const assemblyId = workflowNodeId('assembly', project.id)
  const filmId = workflowNodeId('film', project.id)
  for (const [index, asset] of project.assets.entries()) {
    nodes.push({
      id: workflowNodeId('reference', asset.id), type: 'reference', position: { x: 32, y: 64 + index * 304 },
      data: { kind: 'reference', asset }, deletable: true,
    })
  }
  let row = 64
  const inputs: AssemblyInput[] = []
  for (const [index, shot] of project.shots.entries()) {
    const promptId = workflowNodeId('prompt', shot.id)
    const generationId = workflowNodeId('generation', shot.id)
    const chosen = shot.versions.find(version => version.id === shot.selectedVersionId)
    const latest = shot.versions.at(-1)
    const visible = expanded.has(shot.id) ? shot.versions : shot.versions.filter(version => version === chosen || version === latest)
    const outputs: readonly (VideoVersion | null)[] = visible.length === 0 ? [null] : visible
    nodes.push({ id: promptId, type: 'prompt', position: { x: 336, y: row }, data: { kind: 'prompt', shot }, deletable: true })
    nodes.push({ id: generationId, type: 'generation', position: { x: 640, y: row }, data: { kind: 'generation', shot }, deletable: false })
    edges.push(edge(promptId, generationId, 'text', 'prompt', { kind: 'structure', shotId: shot.id }))
    for (const assetId of shot.assetIds) {
      edges.push(edge(workflowNodeId('reference', assetId), generationId, 'image', 'references', {
        kind: 'reference', assetId, shotId: shot.id,
      }))
    }
    for (const [outputIndex, version] of outputs.entries()) {
      const resultId = workflowNodeId('video-result', shot.id, version?.id)
      nodes.push({
        id: resultId, type: 'video-result', position: { x: 944, y: row + outputIndex * 320 }, deletable: false,
        data: {
          kind: 'video-result', shot, version,
          selected: version !== null && version.id === shot.selectedVersionId,
          stale: version !== null && versionInputsChanged(shot, project.assets, version),
        },
      })
      edges.push(edge(generationId, resultId, 'result', 'generation', { kind: 'structure', shotId: shot.id }))
      if (version !== null && version.id === shot.selectedVersionId && version.status === 'completed' && version.attachment !== undefined) {
        edges.push(edge(resultId, assemblyId, 'video', 'clips', { kind: 'selection', shotId: shot.id, versionId: version.id, index }))
      }
    }
    const ready = chosen?.status === 'completed' && chosen.attachment !== undefined
    inputs.push({ shotId: shot.id, title: shot.title, index, ready, ...chosen === undefined ? {} : { versionId: chosen.id } })
    row += Math.max(320, outputs.length * 320)
  }
  const ready = inputs.length > 0 && inputs.every(input => input.ready)
  nodes.push({
    id: assemblyId, type: 'assembly', position: { x: 1248, y: 64 }, deletable: false,
    data: { kind: 'assembly', inputs, ready },
  })
  const film = [...project.exports].reverse().find(result => result.status === 'completed' && result.attachment !== undefined) ?? null
  const selected = inputs.flatMap(input => input.ready && input.versionId !== undefined ? [input.versionId] : [])
  nodes.push({
    id: filmId, type: 'film', position: { x: 1552, y: 64 }, deletable: false,
    data: {
      kind: 'film', film, ready, latestAttempt: project.exports.at(-1) ?? null,
      stale: film !== null && (selected.length !== project.shots.length || !equalItems(film.shotVersionIds, selected)
        || JSON.stringify(film.clipEdits ?? project.shots.map(() => null))
        !== JSON.stringify(project.shots.map(shot => shot.edit ?? null))),
    },
  })
  edges.push(edge(assemblyId, filmId, 'film', 'assembly', { kind: 'render' }))
  return { nodes, edges }
}

/**
 * Translate an allowed connection into reference selection or film-version adoption.
 * @param project - current staged project; its revision is retained for the Host update.
 * @param graph - projection against which the user gesture was made.
 * @param connection - source and target handles selected by the user.
 * @returns the editable project fields or an explicit rejection; this operation never generates media.
 */
export function connectWorkflowNodes(project: VideoProject, graph: WorkflowGraph, connection: WorkflowConnection): WorkflowEdit {
  const source = graph.nodes.find(node => node.id === connection.source)
  const target = graph.nodes.find(node => node.id === connection.target)
  if (source === undefined || target === undefined) return { kind: 'rejected', reason: 'unknown-node' }
  if (source.data.kind === 'reference' && target.data.kind === 'generation'
    && connection.sourceHandle === 'image' && connection.targetHandle === 'references') {
    const assetId = source.data.asset.id
    const asset = project.assets.find(item => item.id === assetId)
    const targetId = target.data.shot.id
    const shot = project.shots.find(item => item.id === targetId)
    if (shot === undefined || asset === undefined) return { kind: 'rejected', reason: 'unknown-node' }
    if (asset.image === undefined) return { kind: 'rejected', reason: 'reference-without-image' }
    if (shot.assetIds.includes(assetId)) return { kind: 'unchanged' }
    const input = editable(project)
    return {
      kind: 'updated',
      input: { ...input, shots: input.shots.map(item => item.id === targetId ? { ...item, assetIds: [...item.assetIds, assetId] } : item) },
    }
  }
  if (source.data.kind === 'video-result' && target.data.kind === 'assembly'
    && connection.sourceHandle === 'video' && connection.targetHandle === 'clips') {
    const { shot, version } = source.data
    if (version === null || version.status !== 'completed' || version.attachment === undefined) return { kind: 'rejected', reason: 'video-not-ready' }
    const current = project.shots.find(item => item.id === shot.id)
    if (current === undefined || !current.versions.some(item => item.id === version.id && item.status === 'completed' && item.attachment !== undefined)) {
      return { kind: 'rejected', reason: 'unknown-node' }
    }
    if (current.selectedVersionId === version.id) return { kind: 'unchanged' }
    const input = editable(project)
    return {
      kind: 'updated',
      input: { ...input, shots: input.shots.map(item => item.id === shot.id ? { ...item, selectedVersionId: version.id } : item) },
    }
  }
  return { kind: 'rejected', reason: 'unsupported-connection' }
}

/**
 * Remove one editable dependency while retaining media and all other project fields.
 * @param project - current staged project.
 * @param connection - projected edge selected for deletion.
 * @returns changed editable fields, unchanged state for an obsolete edge, or a fixed-edge rejection.
 */
export function disconnectWorkflowEdge(project: VideoProject, connection: WorkflowEdge): WorkflowEdit {
  const data = connection.data
  if (data.kind !== 'reference' && data.kind !== 'selection') return { kind: 'rejected', reason: 'fixed-connection' }
  const shot = project.shots.find(item => item.id === data.shotId)
  if (shot === undefined) return { kind: 'unchanged' }
  const { versions: _versions, ...editableShot } = shot
  let replacement: VideoShotInput
  if (data.kind === 'reference') {
    if (!shot.assetIds.includes(data.assetId)) return { kind: 'unchanged' }
    replacement = { ...editableShot, assetIds: shot.assetIds.filter(id => id !== data.assetId) }
  } else {
    if (shot.selectedVersionId !== data.versionId) return { kind: 'unchanged' }
    const { selectedVersionId: _selected, ...rest } = editableShot
    replacement = rest
  }
  const input = editable(project)
  return { kind: 'updated', input: { ...input, shots: input.shots.map(item => item.id === shot.id ? replacement : item) } }
}
