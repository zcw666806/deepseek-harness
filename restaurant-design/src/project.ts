/** Synchronous, atomic project persistence shared by restaurant tools and browser edits. */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { diningTable, fourSeatTemplate, matchesFourSeatTemplate, placeFourSeat } from './dining.ts'
import { chairEnvelopes, checkLayout, isConvexPolygon } from './geometry.ts'
import type { BasePlan, DiningProposal, DiningProposalId, Door, Furniture, FurnitureGroup, JsonValue, Keepout, LayoutIssue, LayoutState, Point, Project, Rect, Room, Wall } from './types.ts'

/** A recoverable project-domain rejection with a stable RPC/tool error code. */
export class ProjectError extends Error {
  readonly issues: readonly LayoutIssue[] | undefined

  /**
   * Creates a domain error without treating filesystem failures as successful operations.
   * @param code - Stable machine-readable error category.
   * @param message - Task-relevant explanation.
   * @param issues - Layout conflicts responsible for the rejection, if any.
   */
  constructor(readonly code: string, message: string, issues?: readonly LayoutIssue[]) {
    super(message)
    this.name = 'ProjectError'
    this.issues = issues
  }
}

interface History { readonly past: readonly Project[]; readonly future: readonly Project[] }
interface StoredProject extends Project { readonly history: History; readonly baselineIssues: readonly LayoutIssue[] }
interface PendingDiningProposal { readonly preview: DiningProposal; readonly candidate: Project }

function invalid(message: string): never { throw new ProjectError('PROJECT_INVALID', message) }
function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`)
  return value as Record<string, unknown>
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array.`)
  return value
}
function string(value: unknown, label: string, nonempty = true): string {
  if (typeof value !== 'string' || (nonempty && value.trim() === '')) invalid(`${label} must be ${nonempty ? 'a non-empty' : 'a'} string.`)
  return value
}
function number(value: unknown, label: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER || (positive && value <= 0)) invalid(`${label} must be a finite ${positive ? 'positive ' : ''}millimetre value.`)
  return value
}
function point(value: unknown, label: string): Point {
  const values = array(value, label)
  if (values.length !== 2) invalid(`${label} must contain two coordinates.`)
  return [number(values[0], label), number(values[1], label)]
}
function rect(value: unknown, label: string): Rect {
  const values = array(value, label)
  if (values.length !== 4) invalid(`${label} must contain four coordinates.`)
  return [number(values[0], label), number(values[1], label), number(values[2], label), number(values[3], label)]
}
function json(value: unknown, label: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return number(value, label)
  if (Array.isArray(value)) return value.map(item => json(item, label))
  const fields = record(value, label)
  return Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, json(item, `${label}.${key}`)]))
}
function clone<T>(value: T): T { return structuredClone(value) }
function unique(ids: readonly string[], label: string): void {
  if (new Set(ids).size !== ids.length) invalid(`${label} contains duplicate ids.`)
}

function parseFurniture(value: unknown): Furniture {
  const item = record(value, 'furniture')
  const retained = json(item, 'furniture') as Record<string, JsonValue>
  return {
    ...retained,
    id: string(item['id'], 'furniture.id'), type: string(item['type'], 'furniture.type'), name: string(item['name'], 'furniture.name', false),
    cx: number(item['cx'], 'furniture.cx'), cy: number(item['cy'], 'furniture.cy'),
    w: number(item['w'], 'furniture.w', true), d: number(item['d'], 'furniture.d', true),
    rot: number(item['rot'], 'furniture.rot'), color: string(item['color'], 'furniture.color'),
  }
}

function parseState(value: unknown): LayoutState {
  const state = record(value, 'state')
  const furniture = array(state['furniture'], 'state.furniture').map(parseFurniture)
  unique(furniture.map(item => item.id), 'state.furniture')
  const rooms = Object.fromEntries(Object.entries(record(state['rooms'], 'state.rooms')).map(([id, value]) => {
    const room = record(value, `state.rooms.${id}`)
    return [id, { name: string(room['name'], 'room.name', false), mat: string(room['mat'], 'room.mat') }]
  }))
  const demolished = array(state['demolished'], 'state.demolished').map(value => string(value, 'demolished wall id'))
  unique(demolished, 'state.demolished')
  const measures = array(state['measures'], 'state.measures').map(value => {
    const measure = record(value, 'measure')
    const a = record(measure['a'], 'measure.a')
    const b = record(measure['b'], 'measure.b')
    return { a: { x: number(a['x'], 'measure.a.x'), y: number(a['y'], 'measure.a.y') }, b: { x: number(b['x'], 'measure.b.x'), y: number(b['y'], 'measure.b.y') } }
  })
  return { furniture, rooms, demolished, measures }
}

function parseBase(value: unknown): BasePlan {
  const base = record(value, 'base')
  const walls: Wall[] = array(base['walls'], 'base.walls').map(value => {
    const wall = array(value, 'wall')
    if (wall.length !== 5) invalid('A wall must contain four coordinates and a classification.')
    return [number(wall[0], 'wall.x0'), number(wall[1], 'wall.y0'), number(wall[2], 'wall.x1'), number(wall[3], 'wall.y1'), string(wall[4], 'wall.type')]
  })
  const windows = array(base['windows'], 'base.windows').map(value => rect(value, 'window'))
  const slides = array(base['slides'], 'base.slides').map(value => rect(value, 'sliding door'))
  const doors: Door[] = array(base['doors'], 'base.doors').map(value => {
    const door = record(value, 'door')
    const c = point(door['c'], 'door.c')
    const o = point(door['o'], 'door.o')
    if (Math.hypot(...c) === 0 || Math.hypot(...o) === 0) invalid('Door directions must have nonzero length.')
    return { name: string(door['name'], 'door.name'), rect: rect(door['rect'], 'door.rect'), h: point(door['h'], 'door.h'), c, o, len: number(door['len'], 'door.len', true) }
  })
  const rooms: Room[] = array(base['rooms'], 'base.rooms').map(value => {
    const room = record(value, 'room')
    const poly = array(room['poly'], 'room.poly').map(value => point(value, 'room.poly point'))
    if (poly.length < 3) invalid('A room requires at least three perimeter points.')
    if (room['counted'] !== undefined && typeof room['counted'] !== 'boolean') invalid('room.counted must be boolean.')
    return { id: string(room['id'], 'room.id'), name: string(room['name'], 'room.name', false), poly, mat: string(room['mat'], 'room.mat'), at: point(room['at'], 'room.at'), ...(room['counted'] === undefined ? {} : { counted: room['counted'] as boolean }) }
  })
  unique(rooms.map(room => room.id), 'base.rooms')
  const bounds = record(base['bounds'], 'base.bounds')
  return { walls, windows, slides, doors, rooms, bounds: { x: number(bounds['x'], 'bounds.x'), y: number(bounds['y'], 'bounds.y'), w: number(bounds['w'], 'bounds.w', true), h: number(bounds['h'], 'bounds.h', true) } }
}

/**
 * Validates a JSON or durable project before it reaches same-process operations.
 * @param value - Untrusted project document.
 * @returns A detached, validated complete project.
 */
export function parseProject(value: unknown): Project {
  const project = record(value, 'project')
  if (project['formatVersion'] !== 1) invalid('Unsupported restaurant project formatVersion; expected 1.')
  const revision = project['revision']
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) invalid('revision must be a non-negative safe integer.')
  const base = parseBase(project['base'])
  const state = parseState(project['state'])
  const furnitureById = new Map(state.furniture.map(item => [item.id, item]))
  const memberships = new Set<string>()
  const groups: FurnitureGroup[] = array(project['groups'], 'groups').map(value => {
    const group = record(value, 'group')
    const members = array(group['itemIds'], 'group.itemIds').map(value => string(value, 'group item id'))
    if (members.length === 0) invalid('A group must contain at least one furniture item.')
    unique(members, 'group.itemIds')
    for (const id of members) {
      if (!furnitureById.has(id)) invalid(`Group references unknown furniture ${id}.`)
      if (memberships.has(id)) invalid(`Furniture ${id} belongs to more than one group.`)
      memberships.add(id)
    }
    const id = string(group['id'], 'group.id')
    if (furnitureById.has(id)) invalid(`Group id ${id} duplicates a furniture id.`)
    const name = string(group['name'], 'group.name')
    const diningTemplate = group['diningTemplate']
    if (diningTemplate === undefined) return { id, name, itemIds: members }
    if (diningTemplate !== fourSeatTemplate.id || !matchesFourSeatTemplate(members.map(id => furnitureById.get(id)!))) {
      invalid(`Group ${id} does not match the four-seat dining template.`)
    }
    return { id, name, itemIds: members, diningTemplate }
  })
  unique(groups.map(group => group.id), 'groups')
  const keepouts: Keepout[] = array(project['keepouts'], 'keepouts').map(value => {
    const keepout = record(value, 'keepout')
    const polygon = array(keepout['polygon'], 'keepout.polygon').map(value => point(value, 'keepout point'))
    if (!isConvexPolygon(polygon)) invalid('Keepouts must be convex, non-degenerate polygons without a repeated closing vertex.')
    return { id: string(keepout['id'], 'keepout.id'), name: string(keepout['name'], 'keepout.name'), polygon }
  })
  unique(keepouts.map(keepout => keepout.id), 'keepouts')
  const sourceRoomIds = base.rooms.map(room => room.id).sort()
  if (JSON.stringify(Object.keys(state.rooms).sort()) !== JSON.stringify(sourceRoomIds)) invalid('state.rooms must contain exactly the source room ids.')
  for (const id of state.demolished) {
    if (!/^w\d+$/.test(id) || base.walls[Number(id.slice(1))] === undefined) invalid(`Unknown demolished wall ${id}.`)
  }
  return { formatVersion: 1, revision, title: string(project['title'], 'title'), base, state, groups, keepouts }
}

/**
 * Extracts only the supplied editor's single-line JSON declarations without running scripts.
 * @param html - Offline restaurant HTML source, treated as untrusted data.
 * @returns A complete project with explicit empty groups and keepouts.
 */
export function extractProject(html: string): Project {
  const declaration = (name: string, kind: 'const' | 'let'): unknown => {
    const expression = new RegExp(`^${kind} ${name} = (.+);\\s*$`, 'gm')
    const matches = [...html.matchAll(expression)]
    if (matches.length !== 1) invalid(`Expected exactly one JSON declaration for ${name}.`)
    try { return JSON.parse(matches[0]![1]!) as unknown } catch { return invalid(`Declaration ${name} is not valid JSON.`) }
  }
  return parseProject({ formatVersion: 1, revision: 0, title: '餐厅布置方案',
    base: { walls: declaration('WALLS', 'const'), windows: declaration('WINS', 'const'), doors: declaration('DOORS', 'const'), slides: declaration('SLIDES', 'const'), rooms: declaration('ROOMS', 'const'), bounds: declaration('BOUNDS', 'const') },
    state: declaration('state', 'let'), groups: [], keepouts: [] })
}

function parseStored(value: unknown): StoredProject {
  const project = parseProject(value)
  const root = record(value, 'stored project')
  if (root['history'] === undefined) return { ...project, history: { past: [], future: [] }, baselineIssues: checkLayout(project) }
  const history = record(root['history'], 'history')
  const past = array(history['past'], 'history.past').map(parseProject)
  const future = array(history['future'], 'history.future').map(parseProject)
  // Historical construction remains locked too; a malformed history cannot replace the building on undo.
  for (const previous of [...past, ...future]) {
    if (JSON.stringify(previous.base) !== JSON.stringify(project.base) || JSON.stringify(previous.state.demolished) !== JSON.stringify(project.state.demolished)) invalid('Stored history changes locked building data.')
  }
  const baseline = root['baselineIssues']
  if (!Array.isArray(baseline)) invalid('Stored history is missing its imported baseline issues.')
  const baselineIssues = baseline.map(value => {
    const issue = record(value, 'baseline issue')
    const kinds = ['furniture', 'wall', 'window', 'door', 'keepout', 'bounds', 'chair-clearance'] as const
    if (!kinds.includes(issue['kind'] as LayoutIssue['kind'])) invalid('Invalid baseline issue kind.')
    return { key: string(issue['key'], 'issue.key'), kind: issue['kind'] as LayoutIssue['kind'], itemIds: array(issue['itemIds'], 'issue.itemIds').map(value => string(value, 'issue item id')), ...(issue['obstacleId'] === undefined ? {} : { obstacleId: string(issue['obstacleId'], 'issue.obstacleId') }), overlapMm: number(issue['overlapMm'], 'issue.overlapMm'), overlapAreaMm2: number(issue['overlapAreaMm2'], 'issue.overlapAreaMm2'), message: string(issue['message'], 'issue.message') }
  })
  return { ...project, history: { past, future }, baselineIssues }
}

function newConflicts(current: Project, candidate: Project): LayoutIssue[] {
  const previous = new Map(checkLayout(current).map(issue => [issue.key, issue]))
  return checkLayout(candidate).filter(issue => {
    const before = previous.get(issue.key)
    return before === undefined || issue.overlapAreaMm2 > before.overlapAreaMm2 + 1e-6 || issue.overlapMm > before.overlapMm + 1e-6
  })
}

/** Owns one local project's synchronous commits; callers share this instance rather than opening competing writers. */
export class FileProjectStore {
  private current: Project
  private history: History
  private readonly baselineIssues: readonly LayoutIssue[]
  private selection: string[] = []
  private pendingDiningProposal: PendingDiningProposal | undefined

  /**
   * Opens a durable project or initializes a new one from a validated seed.
   * @param path - Project JSON path owned by this single writer.
   * @param initialProject - Complete seed required when the file does not exist.
   */
  constructor(private readonly path: string, initialProject?: Project) {
    if (!existsSync(path) && initialProject === undefined) throw new ProjectError('PROJECT_NOT_FOUND', `Project file does not exist: ${path}`)
    const stored = existsSync(path) ? parseStored(JSON.parse(readFileSync(path, 'utf8')) as unknown) : parseStored(initialProject)
    this.current = parseProject(stored)
    this.history = stored.history
    this.baselineIssues = stored.baselineIssues
    if (!existsSync(path)) this.persist(this.current, this.history)
  }

  /** @returns A detached complete project snapshot, excluding private history. */
  read(): Project { return clone(this.current) }

  /** @returns Whether accepted history can be undone or redone at the current revision. */
  historyState(): { canUndo: boolean; canRedo: boolean } {
    return { canUndo: this.history.past.length > 0, canRedo: this.history.future.length > 0 }
  }

  /**
   * Selects known furniture or groups without creating a project revision.
   * @param ids - Furniture or group ids to expand; an empty list clears selection.
   * @returns The selected furniture ids.
   */
  select(ids: readonly string[]): string[] { this.selection = ids.length === 0 ? [] : this.resolve(ids); return this.getSelection() }

  /** @returns A detached list of the currently selected furniture ids. */
  getSelection(): string[] { return [...this.selection] }

  /**
   * Creates an explicit group with permitted overlaps between its existing members.
   * @param expectedRevision - Snapshot revision on which the request is based.
   * @param name - Non-empty group label.
   * @param itemIds - Existing, ungrouped furniture ids.
   * @returns The committed complete project.
   */
  group(expectedRevision: number, name: string, itemIds: readonly string[]): Project {
    this.expectRevision(expectedRevision)
    if (name.trim() === '') throw new ProjectError('GROUP_INVALID', 'A group name is required.')
    const ids = this.resolve(itemIds)
    for (const id of ids) {
      if (this.current.groups.some(group => group.itemIds.includes(id))) throw new ProjectError('GROUP_INVALID', `${id} already belongs to a group.`)
    }
    return this.commit({ ...this.current, groups: [...this.current.groups, { id: `group-${randomUUID()}`, name: name.trim(), itemIds: ids }] })
  }

  /**
   * Moves selected furniture and every member of any selected group together.
   * @param expectedRevision - Snapshot revision on which the request is based.
   * @param ids - Furniture or group ids; partial groups expand to complete groups.
   * @param dxMm - Horizontal displacement in millimetres.
   * @param dyMm - Vertical plan displacement in millimetres.
   * @returns The committed project, or throws when new/worsened overlaps would result.
   */
  move(expectedRevision: number, ids: readonly string[], dxMm: number, dyMm: number): Project {
    this.expectRevision(expectedRevision)
    number(dxMm, 'dxMm')
    number(dyMm, 'dyMm')
    const selected = new Set(this.resolve(ids))
    const furniture = this.current.state.furniture.map(item => selected.has(item.id) ? { ...item, cx: item.cx + dxMm, cy: item.cy + dyMm } : item)
    return this.commit({ ...this.current, state: { ...this.current.state, furniture } })
  }

  /**
   * Checks a four-seat replacement while leaving the saved project and history intact.
   * @param expectedRevision - Project revision on which the preview is based.
   * @param groupId - Explicit two-seat group, or the single group matching the selection.
   * @returns A detached preview of the replacement and any new or worsened conflicts.
   */
  proposeFourSeat(expectedRevision: number, groupId?: string): DiningProposal {
    this.expectRevision(expectedRevision)
    const selected = new Set(this.selection)
    const group = this.current.groups.find(candidate => groupId !== undefined
      ? candidate.id === groupId
      : candidate.itemIds.length === selected.size && candidate.itemIds.every(id => selected.has(id)))
    if (group === undefined) throw new ProjectError('DINING_GROUP_REQUIRED', 'Select or specify exactly one named two-seat furniture group.')
    const oldItems = new Set(group.itemIds)
    const members = this.current.state.furniture.filter(item => oldItems.has(item.id))
    const table = diningTable(members, 2)
    if (table === undefined) throw new ProjectError('DINING_GROUP_INVALID', 'The group must contain one dining table and two individual chairs.')

    const id = randomUUID() as DiningProposalId
    const chair = members.find(item => item.type === 'chair')!
    const addedItems = placeFourSeat(table, chair.color, index => `dining-${id}-${index}`)
    const replacement = { ...group, itemIds: addedItems.map(item => item.id), diningTemplate: fourSeatTemplate.id }
    const candidate = parseProject({
      ...this.current,
      state: { ...this.current.state, furniture: [...this.current.state.furniture.filter(item => !oldItems.has(item.id)), ...addedItems] },
      groups: this.current.groups.map(existing => existing.id === group.id ? replacement : existing),
    })
    const issues = newConflicts(this.current, candidate)
    const preview: DiningProposal = {
      id, baseRevision: this.current.revision, groupId: group.id, beforeSeats: 2, afterSeats: 4,
      removedItemIds: group.itemIds, addedItems, chairEnvelopes: chairEnvelopes(candidate, group.id),
      template: fourSeatTemplate, issues, canApply: issues.length === 0,
    }
    this.pendingDiningProposal = { preview, candidate }
    return clone(preview)
  }

  /** @returns A detached active preview, or null once its base revision is superseded. */
  getProposal(): DiningProposal | null {
    const preview = this.pendingDiningProposal?.preview
    return preview?.baseRevision === this.current.revision ? clone(preview) : null
  }

  /**
   * Rechecks and saves the preview as one undoable revision.
   * @param proposalId - Exact active preview explicitly confirmed by the user.
   * @returns The committed project. Stale, unknown, and blocked previews leave the project intact.
   */
  applyProposal(proposalId: string): Project {
    const { preview, candidate } = this.requireProposal(proposalId)
    this.expectRevision(preview.baseRevision)
    const selected = preview.removedItemIds.some(id => this.selection.includes(id))
    const committed = this.commit(candidate)
    this.pendingDiningProposal = undefined
    if (selected) this.selection.push(...preview.addedItems.map(item => item.id))
    return committed
  }

  /**
   * Discards the matching preview without changing the project or history.
   * @param proposalId - Exact preview to discard.
   */
  cancelProposal(proposalId: string): void {
    this.requireProposal(proposalId)
    this.pendingDiningProposal = undefined
  }

  /**
   * Commits browser state after validating JSON fields and the locked construction.
   * @param expectedRevision - Snapshot revision on which the edit is based.
   * @param state - Untrusted editor state, not a complete project.
   * @returns The committed project, or throws without publishing rejected edits.
   */
  replaceState(expectedRevision: number, state: unknown): Project {
    this.expectRevision(expectedRevision)
    const parsed = parseState(state)
    if (JSON.stringify(parsed.demolished) !== JSON.stringify(this.current.state.demolished)) throw new ProjectError('LOCKED_BASE', 'Wall demolition is locked for this restaurant project.')
    const rooms = Object.keys(parsed.rooms).sort()
    if (JSON.stringify(rooms) !== JSON.stringify(this.current.base.rooms.map(room => room.id).sort())) throw new ProjectError('LOCKED_BASE', 'Room identities are locked for this restaurant project.')
    for (const room of Object.values(parsed.rooms)) {
      if (!['wood', 'walnut', 'tile800', 'tile600', 'marble', 'antislip', 'terrazzo', 'carpet'].includes(room.mat)) invalid(`Unknown editor floor material ${room.mat}.`)
    }
    const beforeItems = new Map(this.current.state.furniture.map(item => [item.id, item]))
    const afterItems = new Map(parsed.furniture.map(item => [item.id, item]))
    for (const group of this.current.groups) {
      const anchor = beforeItems.get(group.itemIds[0]!)!
      const movedAnchor = afterItems.get(anchor.id)
      if (movedAnchor === undefined) throw new ProjectError('GROUP_RIGID', `Group ${group.id} cannot lose members. Undo its grouping before deleting individual furniture.`)
      const dx = movedAnchor.cx - anchor.cx
      const dy = movedAnchor.cy - anchor.cy
      for (const id of group.itemIds) {
        const before = beforeItems.get(id)!
        const after = afterItems.get(id)
        if (after === undefined || before.type !== after.type || before.w !== after.w || before.d !== after.d || before.rot !== after.rot
          || Math.abs(after.cx - before.cx - dx) > 1e-6 || Math.abs(after.cy - before.cy - dy) > 1e-6) {
          throw new ProjectError('GROUP_RIGID', `Group ${group.id} is a rigid translation group. Move every member by the same amount; independent resizing, rotation or deletion is not supported.`)
        }
      }
    }
    return this.commit({ ...this.current, state: parsed })
  }

  /**
   * Restores the previous accepted state with a new monotonically increasing revision.
   * @param expectedRevision - Current snapshot revision.
   * @returns The restored complete project.
   */
  undo(expectedRevision: number): Project {
    this.expectRevision(expectedRevision)
    const previous = this.history.past[this.history.past.length - 1]
    if (previous === undefined) throw new ProjectError('NO_UNDO', 'No earlier accepted layout is available.')
    return this.restore(previous, { past: this.history.past.slice(0, -1), future: [...this.history.future, this.current] })
  }

  /**
   * Restores the last undone state with a new monotonically increasing revision.
   * @param expectedRevision - Current snapshot revision.
   * @returns The restored complete project.
   */
  redo(expectedRevision: number): Project {
    this.expectRevision(expectedRevision)
    const next = this.history.future[this.history.future.length - 1]
    if (next === undefined) throw new ProjectError('NO_REDO', 'No undone layout is available.')
    return this.restore(next, { past: [...this.history.past, this.current], future: this.history.future.slice(0, -1) })
  }

  /** @returns Current imported or newly accepted plan-view issues. */
  check(): LayoutIssue[] { return checkLayout(this.current) }

  private requireProposal(id: string): PendingDiningProposal {
    const pending = this.pendingDiningProposal
    if (pending?.preview.id !== id) throw new ProjectError('PROPOSAL_NOT_FOUND', 'The dining proposal is no longer active. Request a new preview.')
    return pending
  }

  private expectRevision(expected: number): void {
    if (expected !== this.current.revision) throw new ProjectError('REVISION_CONFLICT', `Expected revision ${String(expected)}, current revision is ${String(this.current.revision)}.`)
  }

  private resolve(ids: readonly string[]): string[] {
    if (ids.length === 0) throw new ProjectError('EMPTY_SELECTION', 'Select at least one furniture item or group.')
    const known = new Set(this.current.state.furniture.map(item => item.id))
    const result = new Set<string>()
    for (const id of ids) {
      const group = this.current.groups.find(group => group.id === id || group.itemIds.includes(id))
      if (group !== undefined) group.itemIds.forEach(member => result.add(member))
      else if (known.has(id)) result.add(id)
      else throw new ProjectError('UNKNOWN_ITEM', `Unknown furniture or group ${id}.`)
    }
    return [...result]
  }

  private commit(candidate: Project): Project {
    if (this.current.revision === Number.MAX_SAFE_INTEGER) throw new ProjectError('REVISION_LIMIT', 'Project revision limit reached.')
    const next = parseProject({ ...candidate, revision: this.current.revision + 1 })
    const conflicts = newConflicts(this.current, next)
    if (conflicts.length > 0) throw new ProjectError('LAYOUT_CONFLICT', 'The edit creates or worsens a layout overlap.', conflicts)
    const history = { past: [...this.history.past, this.current], future: [] }
    this.persist(next, history)
    this.current = next
    this.history = history
    this.trimSelection()
    return this.read()
  }

  private restore(snapshot: Project, history: History): Project {
    if (this.current.revision === Number.MAX_SAFE_INTEGER) throw new ProjectError('REVISION_LIMIT', 'Project revision limit reached.')
    const next = { ...snapshot, revision: this.current.revision + 1 }
    this.persist(next, history)
    this.current = next
    this.history = history
    this.trimSelection()
    return this.read()
  }

  private trimSelection(): void {
    const ids = new Set(this.current.state.furniture.map(item => item.id))
    this.selection = this.selection.filter(id => ids.has(id))
  }

  private persist(project: Project, history: History): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, `${JSON.stringify({ ...project, history, baselineIssues: this.baselineIssues }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      renameSync(temporary, this.path)
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary)
    }
  }
}
