/** Production facts determine graph connections and every accepted edit's persisted meaning. */

import { describe, expect, it } from 'vitest'
import type { AttachmentId, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  VideoAssetId, VideoProject, VideoProjectInput, VideoVersion, VideoVersionId,
} from '@deepseek-ai/dsh-video-production/types'
import {
  connectWorkflowNodes, disconnectWorkflowEdge, projectWorkflowGraph, versionInputsChanged, workflowNodeId,
  type WorkflowConnection,
} from '../src/client/workflow-graph.ts'
import { project, SHOT_A, SHOT_B, VERSION_A, VIDEO } from './fixtures.ts'

const ASSET = 'traveler' as VideoAssetId
const IMAGE: ImageAttachmentRef = {
  attachmentId: 'reference-image' as AttachmentId, mediaType: 'image/png', bytes: 100, width: 10, height: 10,
}

function withAsset(): VideoProject {
  return { ...project(), assets: [{ id: ASSET, name: 'Traveler', kind: 'character', description: '', image: IMAGE }] }
}

function applyInput(current: VideoProject, input: VideoProjectInput): VideoProject {
  return { ...current, ...input, shots: input.shots.map(shot => ({
    ...shot, versions: current.shots.find(item => item.id === shot.id)?.versions ?? [],
  })) }
}

function referenceConnection(): WorkflowConnection {
  return {
    source: workflowNodeId('reference', ASSET), target: workflowNodeId('generation', SHOT_A),
    sourceHandle: 'image', targetHandle: 'references',
  }
}

describe('production workflow graph', () => {
  it('projects real reference and adopted-version edges instead of connecting neighboring shots', () => {
    const current = withAsset()
    const linked = { ...current, shots: current.shots.map(shot => shot.id === SHOT_A ? { ...shot, assetIds: [ASSET] } : shot) }
    const graph = projectWorkflowGraph(linked)
    expect(new Set(graph.nodes.map(node => node.type))).toEqual(new Set([
      'reference', 'prompt', 'generation', 'video-result', 'assembly', 'film',
    ]))
    expect(graph.edges.find(edge => edge.data.kind === 'reference')).toMatchObject(referenceConnection())
    expect(graph.edges.find(edge => edge.data.kind === 'selection')).toMatchObject({
      source: workflowNodeId('video-result', SHOT_A, VERSION_A), target: workflowNodeId('assembly', current.id),
      data: { kind: 'selection', shotId: SHOT_A, versionId: VERSION_A, index: 0 }, deletable: true,
    })
    expect(graph.edges.filter(edge => edge.data.kind === 'structure').every(edge => !edge.deletable)).toBe(true)
    expect(graph.edges.some(edge => edge.source === workflowNodeId('generation', SHOT_A)
      && edge.target === workflowNodeId('generation', SHOT_B))).toBe(false)
  })

  it('connecting and removing a reference updates the same assetIds consumed by generation', () => {
    const current = withAsset()
    const result = connectWorkflowNodes(current, projectWorkflowGraph(current), referenceConnection())
    if (result.kind !== 'updated') throw new Error('Reference connection was not accepted.')
    expect(result.input.shots[0]?.assetIds).toEqual([ASSET])
    expect(result.input.shots[0]).not.toHaveProperty('versions')
    const linked = applyInput(current, result.input)
    expect(connectWorkflowNodes(linked, projectWorkflowGraph(linked), referenceConnection())).toEqual({ kind: 'unchanged' })
    const edge = projectWorkflowGraph(linked).edges.find(item => item.data.kind === 'reference')!
    const disconnected = disconnectWorkflowEdge(linked, edge)
    if (disconnected.kind !== 'updated') throw new Error('Reference disconnection was not accepted.')
    expect(disconnected.input.shots[0]?.assetIds).toEqual([])
    expect(disconnected.input.shots[0]).not.toHaveProperty('versions')
    expect(linked.shots[0]?.versions).toHaveLength(1)
  })

  it('adopts only completed recorded videos and removes selection without deleting the shot or media', () => {
    const original = project()
    const { selectedVersionId: _selected, ...unselected } = original.shots[0]!
    const current: VideoProject = { ...original, shots: [unselected] }
    const graph = projectWorkflowGraph(current)
    const result = connectWorkflowNodes(current, graph, {
      source: workflowNodeId('video-result', SHOT_A, VERSION_A), target: workflowNodeId('assembly', current.id),
      sourceHandle: 'video', targetHandle: 'clips',
    })
    if (result.kind !== 'updated') throw new Error('Completed version was not adopted.')
    expect(result.input.shots[0]?.selectedVersionId).toBe(VERSION_A)
    const adopted = applyInput(current, result.input)
    const selection = projectWorkflowGraph(adopted).edges.find(edge => edge.data.kind === 'selection')!
    const removed = disconnectWorkflowEdge(adopted, selection)
    if (removed.kind !== 'updated') throw new Error('Selected version was not disconnected.')
    expect(removed.input.shots).toHaveLength(1)
    expect(removed.input.shots[0]).not.toHaveProperty('selectedVersionId')
    expect(removed.input.shots[0]).not.toHaveProperty('versions')
    expect(adopted.shots[0]?.versions[0]?.attachment).toBe(VIDEO)
    const newer = { ...adopted, shots: adopted.shots.map(shot => ({ ...shot, selectedVersionId: 'newer' as VideoVersionId })) }
    expect(disconnectWorkflowEdge(newer, selection)).toEqual({ kind: 'unchanged' })
  })

  it('rejects cross-shot prompt rewiring, incomplete outputs, fixed edge deletion, and references without images', () => {
    const current = withAsset()
    const graph = projectWorkflowGraph(current)
    expect(connectWorkflowNodes(current, graph, {
      source: workflowNodeId('prompt', SHOT_A), target: workflowNodeId('generation', SHOT_B),
      sourceHandle: 'text', targetHandle: 'prompt',
    })).toEqual({ kind: 'rejected', reason: 'unsupported-connection' })
    expect(connectWorkflowNodes(current, graph, {
      source: workflowNodeId('video-result', SHOT_B), target: workflowNodeId('assembly', current.id),
      sourceHandle: 'video', targetHandle: 'clips',
    })).toEqual({ kind: 'rejected', reason: 'video-not-ready' })
    expect(disconnectWorkflowEdge(current, graph.edges.find(edge => edge.data.kind === 'structure')!))
      .toEqual({ kind: 'rejected', reason: 'fixed-connection' })
    const { image: _image, ...withoutImage } = current.assets[0]!
    expect(connectWorkflowNodes({ ...current, assets: [withoutImage] }, graph, referenceConnection()))
      .toEqual({ kind: 'rejected', reason: 'reference-without-image' })
    expect(connectWorkflowNodes({ ...current, assets: [] }, graph, referenceConnection()))
      .toEqual({ kind: 'rejected', reason: 'unknown-node' })
  })

  it('marks recorded outputs as stale after prompt or reference changes without pretending to regenerate them', () => {
    const current = withAsset()
    const original = current.shots[0]!
    const version = original.versions[0]!
    expect(versionInputsChanged(original, current.assets, version)).toBe(false)
    expect(versionInputsChanged({ ...original, prompt: 'Another picture' }, current.assets, version)).toBe(true)
    expect(versionInputsChanged({ ...original, assetIds: [ASSET] }, current.assets, version)).toBe(true)
    expect(versionInputsChanged({ ...original, assetIds: [ASSET] }, current.assets, { ...version, referenceImages: [IMAGE] })).toBe(false)
    const graph = projectWorkflowGraph({ ...current, shots: [{ ...original, duration: 7 }] })
    const output = graph.nodes.find(node => node.type === 'video-result')
    expect(output?.data).toMatchObject({ selected: true, stale: true, version: { id: VERSION_A } })
  })

  it('uses the recorded export sources to mark a film outdated when the adopted version changes', () => {
    const original = project()
    const current: VideoProject = { ...original, shots: [original.shots[0]!], exports: [{
      id: 'export-1' as VideoVersionId, status: 'completed', shotVersionIds: [VERSION_A], attachment: VIDEO,
    }] }
    expect(projectWorkflowGraph(current).nodes.find(node => node.type === 'film')?.data).toMatchObject({ stale: false })
    const edited = { ...current, shots: current.shots.map(shot => ({ ...shot, edit: { trimStartSeconds: 0.25 } })) }
    expect(projectWorkflowGraph(edited).nodes.find(node => node.type === 'film')?.data).toMatchObject({ stale: true })
    expect(versionInputsChanged(edited.shots[0]!, edited.assets, edited.shots[0]!.versions[0]!)).toBe(false)
    const newer: VideoVersion = { ...current.shots[0]!.versions[0]!, id: 'new-version' as VideoVersionId }
    const updated: VideoProject = { ...current, shots: current.shots.map(shot => ({
      ...shot, versions: [...shot.versions, newer], selectedVersionId: newer.id,
    })) }
    expect(projectWorkflowGraph(updated).nodes.find(node => node.type === 'film')?.data).toMatchObject({
      stale: true, film: { id: 'export-1', shotVersionIds: [VERSION_A] },
    })
  })

  it('collapses old attempts by default and expands their real recorded nodes on request', () => {
    const original = project()
    const shot = original.shots[0]!
    const middle = { ...shot.versions[0]!, id: 'middle' as VideoVersionId }
    const last = { ...shot.versions[0]!, id: 'last' as VideoVersionId, status: 'failed' as const }
    const current = { ...original, shots: [{ ...shot, versions: [shot.versions[0]!, middle, last] }] }
    expect(projectWorkflowGraph(current).nodes.filter(node => node.type === 'video-result')).toHaveLength(2)
    expect(projectWorkflowGraph(current, [SHOT_A]).nodes.filter(node => node.type === 'video-result')).toHaveLength(3)
    expect(workflowNodeId('reference', 'a:b')).not.toBe(workflowNodeId('reference', 'a', 'b'))
  })
})
