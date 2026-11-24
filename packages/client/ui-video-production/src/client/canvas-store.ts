/** Session-scoped viewing state for the storyboard canvas. */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Canvas coordinates in unscaled CSS pixels. */
export interface CanvasPoint { x: number; y: number }

/** Presentation state independent of the persisted production project. */
export interface VideoCanvasState {
  positions: Record<string, CanvasPoint>
  viewport: { x: number; y: number; zoom: number } | null
  selectedNodeIds: string[]
  selectedEdgeIds: string[]
  zoom: number
  selectedShotId: string | null
  generationTargetKey?: string | null
}

type CanvasActions = {
  viewport: (draft: VideoCanvasState, value: { x: number; y: number; zoom: number }) => void
  selectNodes: (draft: VideoCanvasState, ids: string[]) => void
  selectEdges: (draft: VideoCanvasState, ids: string[]) => void
  resetLayout: (draft: VideoCanvasState) => void
  move: (draft: VideoCanvasState, id: string, point: CanvasPoint) => void
  select: (draft: VideoCanvasState, id: string | null) => void
  selectGenerationTarget: (draft: VideoCanvasState, key: string | null) => void
}

/**
 * Place a shot on the storyboard's three-column grid.
 * @param index - zero-based sequence index.
 * @returns unscaled top-left coordinates.
 */
export function gridPoint(index: number): CanvasPoint {
  return { x: 32 + (index % 3) * 348, y: 32 + Math.floor(index / 3) * 382 }
}

/**
 * Create the persisted per-session canvas view state.
 * @returns handle instantiated by the slot renderer.
 */
export function createVideoCanvasStore(): EngineStoreHandle<VideoCanvasState, CanvasActions> {
  return defineStore({
    init: (): VideoCanvasState => ({
      positions: {}, viewport: null, selectedNodeIds: [], selectedEdgeIds: [], zoom: 1, selectedShotId: null,
    }),
    persist: 'dsh.video-production.workflow-canvas.v1',
    actions: {
      viewport: (draft, value) => { draft.viewport = value; draft.zoom = value.zoom },
      selectNodes: (draft, ids) => { draft.selectedNodeIds = ids },
      selectEdges: (draft, ids) => { draft.selectedEdgeIds = ids },
      resetLayout: (draft) => { draft.positions = {} },
      move: (draft, id, point) => {
        draft.positions[id] = { x: point.x, y: point.y }
      },
      select: (draft, id) => { draft.selectedShotId = id },
      selectGenerationTarget: (draft, key) => { draft.generationTargetKey = key },
    },
  })
}
