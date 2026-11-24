/** Persisted restaurant geometry and editable furniture, expressed in millimetres. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** A position in the source plan's horizontal coordinate system. */
export type Point = readonly [number, number]

/** An axis-aligned source rectangle. */
export type Rect = readonly [number, number, number, number]

/** A source wall rectangle and its original classification. */
export type Wall = readonly [number, number, number, number, string]

/** Values preserved from JSON imports without executing source code. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** One furniture item in the original editor's coordinate system. */
export interface Furniture {
  readonly id: string
  readonly type: string
  readonly name: string
  readonly cx: number
  readonly cy: number
  readonly w: number
  readonly d: number
  readonly rot: number
  readonly color: string
  readonly [key: string]: JsonValue
}

/** A hinged door's source opening, hinge and closed/open directions. */
export interface Door {
  readonly name: string
  readonly rect: Rect
  readonly h: Point
  readonly c: Point
  readonly o: Point
  readonly len: number
  readonly [key: string]: JsonValue | readonly number[]
}

/** A source room polygon retained for display rather than inferred surveying. */
export interface Room {
  readonly id: string
  readonly name: string
  readonly poly: readonly Point[]
  readonly mat: string
  readonly at: Point
  readonly counted?: boolean
}

/** Immutable building data shared by the editor and layout checks. */
export interface BasePlan {
  readonly walls: readonly Wall[]
  readonly windows: readonly Rect[]
  readonly doors: readonly Door[]
  readonly slides: readonly Rect[]
  readonly rooms: readonly Room[]
  readonly bounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
}

/** Editable state compatible with the supplied offline editor. */
export interface LayoutState {
  readonly furniture: readonly Furniture[]
  readonly rooms: Readonly<Record<string, { readonly name: string; readonly mat: string }>>
  readonly demolished: readonly string[]
  readonly measures: readonly { readonly a: { readonly x: number; readonly y: number }; readonly b: { readonly x: number; readonly y: number } }[]
}

/** Explicit membership of objects moved together, including permitted internal overlaps. */
export interface FurnitureGroup {
  readonly id: string
  readonly name: string
  readonly itemIds: readonly string[]
  /** An applied dining template retains its chair pullout checks on later edits. */
  readonly diningTemplate?: DiningTemplate['id']
}

/** A manually designated convex area that must remain free of furniture. */
export interface Keepout {
  readonly id: string
  readonly name: string
  readonly polygon: readonly Point[]
}

/** Complete independently loadable restaurant project. */
export interface Project {
  readonly formatVersion: 1
  readonly revision: number
  readonly title: string
  readonly base: BasePlan
  readonly state: LayoutState
  readonly groups: readonly FurnitureGroup[]
  readonly keepouts: readonly Keepout[]
}

/** One geometric overlap, not an assessment of engineering or fire compliance. */
export interface LayoutIssue {
  readonly key: string
  readonly kind: 'furniture' | 'wall' | 'window' | 'door' | 'keepout' | 'bounds' | 'chair-clearance'
  readonly itemIds: readonly string[]
  readonly obstacleId?: string
  readonly overlapMm: number
  readonly overlapAreaMm2: number
  readonly message: string
}

/** Planning dimensions for the rectangular dining template. */
export interface DiningTemplate {
  readonly id: 'rectangular-four-seat-v1'
  readonly tableWidthMm: number
  readonly tableDepthMm: number
  readonly chairWidthMm: number
  readonly chairDepthMm: number
  readonly chairPulloutMm: number
}

/** The chair's footprint swept outward from the table by the planning pullout distance. */
export interface ChairEnvelope {
  readonly itemId: string
  readonly polygon: readonly Point[]
}

/** Identifies one in-memory dining replacement at one project revision. */
export type DiningProposalId = Branded<'restaurant-dining-proposal-id'>

/** A checked replacement preview detached from the saved restaurant layout. */
export interface DiningProposal {
  readonly id: DiningProposalId
  readonly baseRevision: number
  readonly groupId: string
  readonly beforeSeats: 2
  readonly afterSeats: 4
  readonly removedItemIds: readonly string[]
  readonly addedItems: readonly Furniture[]
  readonly chairEnvelopes: readonly ChairEnvelope[]
  readonly template: DiningTemplate
  readonly issues: readonly LayoutIssue[]
  readonly canApply: boolean
}
