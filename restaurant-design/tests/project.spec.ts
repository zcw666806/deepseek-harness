import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractProject, FileProjectStore, parseProject, ProjectError } from '../src/project.ts'
import type { Furniture, Project } from '../src/types.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const item = (id: string, cx: number, cy = 0): Furniture => ({ id, type: 'table', name: id, cx, cy, w: 100, d: 100, rot: 0, color: '#abcdef' })
const project = (furniture = [item('a', 0), item('b', 1000)]): Project => ({ formatVersion: 1, revision: 0, title: 'Restaurant', base: { walls: [], windows: [], doors: [], slides: [], rooms: [], bounds: { x: -5000, y: -5000, w: 10000, h: 10000 } }, state: { furniture, rooms: {}, demolished: [], measures: [] }, groups: [], keepouts: [] })
function opened(seed = project()): { store: FileProjectStore; path: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'restaurant-project-'))
  roots.push(root)
  const path = join(root, 'project.json')
  return { store: new FileProjectStore(path, seed), path, root }
}
function code(operation: () => unknown): string {
  try { operation() } catch (error) { if (error instanceof ProjectError) return error.code; throw error }
  throw new Error('Expected a project rejection')
}

function diningProject(rotation = 0): Project {
  const seed = project([
    { ...item('table', 0), type: 'diningtable', w: 600, d: 700, rot: rotation },
    { ...item('chair-a', -400), type: 'chair' },
    { ...item('chair-b', 400), type: 'chair' },
  ])
  return { ...seed, groups: [{ id: 'two-seat', name: 'Dining group', itemIds: ['table', 'chair-a', 'chair-b'] }] }
}

describe('restaurant project persistence', () => {
  it('persists complete projects and returns detached snapshots', () => {
    const { store, path } = opened()
    const snapshot = store.read()
    ;(snapshot.state.furniture as Furniture[]).push(item('detached', 2000))
    expect(store.read().state.furniture).toHaveLength(2)
    expect(new FileProjectStore(path).read()).toEqual(project())
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ baselineIssues: [], history: { past: [], future: [] } })
  })

  it('moves complete groups, keeps selection private, and restores persisted undo/redo with increasing revisions', () => {
    const { store, path } = opened()
    const grouped = store.group(0, 'Dining set', ['a', 'b'])
    expect(grouped.revision).toBe(1)
    expect(store.select([grouped.groups[0]!.id])).toEqual(['a', 'b'])
    const moved = store.move(1, ['a'], 300, 20)
    expect(moved.state.furniture.map(item => [item.cx, item.cy])).toEqual([[300, 20], [1300, 20]])
    expect(moved.revision).toBe(2)
    const reopened = new FileProjectStore(path)
    expect(reopened.getSelection()).toEqual([])
    const undone = reopened.undo(2)
    expect(undone.revision).toBe(3)
    expect(undone.state.furniture).toEqual(project().state.furniture)
    const redone = new FileProjectStore(path).redo(3)
    expect(redone.revision).toBe(4)
    expect(redone.state.furniture).toEqual(moved.state.furniture)
  })

  it('rejects stale versions, missing/empty selections and ambiguous group membership', () => {
    const { store } = opened()
    expect(code(() => store.move(1, ['a'], 10, 0))).toBe('REVISION_CONFLICT')
    expect(code(() => store.move(0, [], 10, 0))).toBe('EMPTY_SELECTION')
    expect(code(() => store.select(['missing']))).toBe('UNKNOWN_ITEM')
    store.select(['a'])
    expect(code(() => store.select(['b', 'missing']))).toBe('UNKNOWN_ITEM')
    expect(store.getSelection()).toEqual(['a'])
    expect(store.select([])).toEqual([])
    expect(code(() => store.group(0, ' ', ['a']))).toBe('GROUP_INVALID')
    store.group(0, 'Set', ['a'])
    expect(code(() => store.group(1, 'Other', ['a']))).toBe('GROUP_INVALID')
    expect(store.read().revision).toBe(1)
  })

  it('refuses new overlaps and preserves both the file and current revision on rejection', () => {
    const { store, path } = opened()
    const before = readFileSync(path, 'utf8')
    expect(code(() => store.move(0, ['a'], 950, 0))).toBe('LAYOUT_CONFLICT')
    expect(store.read()).toEqual(project())
    expect(readFileSync(path, 'utf8')).toBe(before)
    try { store.move(0, ['a'], 950, 0) } catch (error) {
      expect((error as ProjectError).issues?.[0]?.itemIds).toEqual(['a', 'b'])
    }
  })

  it('keeps baseline defects, allows unrelated edits and improving overlaps, and rejects worsening them', () => {
    const initial = project([item('a', 0), item('b', 70), item('other', 1500)])
    const { store, path } = opened(initial)
    expect(store.check()).toHaveLength(1)
    expect(store.move(0, ['other'], 100, 0).revision).toBe(1)
    expect(code(() => store.move(1, ['b'], -10, 0))).toBe('LAYOUT_CONFLICT')
    expect(store.move(1, ['b'], 10, 0).revision).toBe(2)
    expect(store.check()[0]!.overlapAreaMm2).toBe(2000)
    expect(JSON.parse(readFileSync(path, 'utf8')).baselineIssues[0].overlapAreaMm2).toBe(3000)
  })

  it('locks wall demolition and validates all external furniture fields before changing state', () => {
    const initial = project()
    const { store } = opened({ ...initial, base: { ...initial.base, walls: [[3000, 0, 3010, 500, 'n']] } })
    expect(code(() => store.replaceState(0, { ...initial.state, demolished: ['w0'] }))).toBe('LOCKED_BASE')
    for (const replacement of [
      { ...initial.state, furniture: [item('a', 0), item('a', 500)] },
      { ...initial.state, furniture: [{ ...item('a', 0), w: 0 }] },
      { ...initial.state, furniture: [{ ...item('a', 0), cx: Infinity }] },
      { ...initial.state, furniture: [{ ...item('a', 0), rot: NaN }] },
    ]) expect(code(() => store.replaceState(0, replacement))).toBe('PROJECT_INVALID')
    expect(store.read().revision).toBe(0)
    expect(store.replaceState(0, { ...initial.state, measures: [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }] }).revision).toBe(1)
  })

  it('requires whole-group translation before granting internal overlap exemptions', () => {
    const { store, path } = opened()
    store.group(0, 'Dining set', ['a', 'b'])
    const before = readFileSync(path, 'utf8')
    const state = store.read().state
    for (const furniture of [
      state.furniture.map(item => item.id === 'a' ? { ...item, cx: item.cx + 10 } : item),
      state.furniture.map(item => item.id === 'a' ? { ...item, w: item.w + 10 } : item),
      state.furniture.map(item => item.id === 'a' ? { ...item, rot: 45 } : item),
      state.furniture.filter(item => item.id !== 'a'),
      [],
    ]) expect(code(() => store.replaceState(1, { ...state, furniture }))).toBe('GROUP_RIGID')
    expect(readFileSync(path, 'utf8')).toBe(before)
    const moved = store.replaceState(1, { ...state, furniture: state.furniture.map(item => ({ ...item, cx: item.cx + 300, cy: item.cy + 10 })) })
    expect(moved.revision).toBe(2)
    expect(moved.state.furniture.map(item => [item.cx, item.cy])).toEqual([[300, 10], [1300, 10]])
  })

  it('drops redo after a new accepted edit and removes deleted ungrouped items from selection', () => {
    const { store } = opened()
    store.select(['a'])
    store.move(0, ['a'], 100, 0)
    store.undo(1)
    store.replaceState(2, { ...store.read().state, furniture: [] })
    expect(store.read().groups).toEqual([])
    expect(store.getSelection()).toEqual([])
    expect(code(() => store.redo(3))).toBe('NO_REDO')
    const { store: emptyHistory } = opened()
    expect(code(() => emptyHistory.undo(0))).toBe('NO_UNDO')
  })

  it('does not publish a revision or leave its temporary file when rename fails', () => {
    const { store, path, root } = opened()
    const original = readFileSync(path, 'utf8')
    rmSync(path)
    mkdirSync(path)
    expect(() => store.move(0, ['a'], 10, 0)).toThrow()
    expect(store.read().revision).toBe(0)
    expect(readdirSync(root)).toEqual(['project.json'])
    rmSync(path, { recursive: true })
    writeFileSync(path, original)
    expect(new FileProjectStore(path).read()).toEqual(store.read())
  })

  it('rejects unsupported durable formats and history that changes fixed construction', () => {
    const { store, path } = opened()
    expect(code(() => parseProject({ ...store.read(), formatVersion: 0 }))).toBe('PROJECT_INVALID')
    const stored = JSON.parse(readFileSync(path, 'utf8'))
    stored.history.past = [{ ...store.read(), base: { ...store.read().base, walls: [[0, 0, 20, 20, 'n']] } }]
    writeFileSync(path, JSON.stringify(stored))
    expect(code(() => new FileProjectStore(path))).toBe('PROJECT_INVALID')
  })
})

describe('safe offline HTML extraction', () => {
  it('reads data declarations without executing any attached script', () => {
    const seed = project()
    const declarations = [
      ['WALLS', seed.base.walls], ['WINS', seed.base.windows], ['DOORS', seed.base.doors], ['SLIDES', seed.base.slides], ['ROOMS', seed.base.rooms], ['BOUNDS', seed.base.bounds],
    ].map(([name, value]) => `const ${String(name)} = ${JSON.stringify(value)};`)
    const source = `<script>\nthrow new Error('Never execute attached content');\n${declarations.join('\n')}\nlet state = ${JSON.stringify(seed.state)};\n</script>`
    expect(extractProject(source).state).toEqual(seed.state)
    expect(code(() => extractProject(`${source}\nconst WALLS = [];`))).toBe('PROJECT_INVALID')
    expect(code(() => extractProject(source.replace('const WALLS = [];', 'const WALLS = (() => [])();')))).toBe('PROJECT_INVALID')
  })
})

describe('four-seat replacement', () => {
  it('previews a rotated replacement without changing the project, then applies and undoes it in one revision each', () => {
    const initial = diningProject(90)
    const { store, path } = opened(initial)
    const saved = readFileSync(path, 'utf8')
    store.select(['table'])
    const proposal = store.proposeFourSeat(0)

    expect(proposal).toMatchObject({ baseRevision: 0, groupId: 'two-seat', beforeSeats: 2, afterSeats: 4,
      canApply: true, issues: [], removedItemIds: ['table', 'chair-a', 'chair-b'],
      template: { tableWidthMm: 1200, tableDepthMm: 750, chairPulloutMm: 300 },
    })
    expect(proposal.addedItems[0]).toMatchObject({ type: 'table', cx: 0, cy: 0, w: 1200, d: 750, rot: 90 })
    expect(proposal.addedItems.slice(1).map(({ type, cx, cy, rot }) => [type, Math.round(cx), Math.round(cy), rot])).toEqual([
      ['chair', 600, -300, 90], ['chair', 600, 300, 90], ['chair', -600, -300, 270], ['chair', -600, 300, 270],
    ])
    expect(proposal.chairEnvelopes).toHaveLength(4)
    expect(Math.max(...proposal.chairEnvelopes[0]!.polygon.map(([x]) => x))).toBeCloseTo(1125)
    expect(store.getProposal()).toEqual(proposal)
    expect(store.read()).toEqual(initial)
    expect(store.historyState().canUndo).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(saved)
    expect(new FileProjectStore(path).getProposal()).toBeNull()

    const replacement = store.applyProposal(proposal.id)
    expect(replacement.revision).toBe(1)
    expect(replacement.state.furniture).toEqual(proposal.addedItems)
    expect(replacement.groups).toEqual([{ ...initial.groups[0], itemIds: proposal.addedItems.map(item => item.id), diningTemplate: proposal.template.id }])
    expect(store.getSelection()).toEqual(replacement.groups[0]!.itemIds)
    expect(store.getProposal()).toBeNull()
    expect(code(() => store.applyProposal(proposal.id))).toBe('PROPOSAL_NOT_FOUND')
    const restored = new FileProjectStore(path).undo(1)
    expect(restored).toEqual({ ...initial, revision: 2 })
  })

  it('blocks pulled-chair conflicts with neighboring furniture, fixed geometry and a designated keepout', () => {
    const initial = diningProject()
    const { store, path } = opened({
      ...initial,
      base: { ...initial.base, walls: [[-500, -1100, -100, -950, 'n']] },
      state: { ...initial.state, furniture: [...initial.state.furniture, item('cabinet', 300, -1000)] },
      keepouts: [{ id: 'entry', name: 'Entrance', polygon: [[100, 930], [500, 930], [500, 1100], [100, 1100]] }],
    })
    const saved = readFileSync(path, 'utf8')
    const proposal = store.proposeFourSeat(0, 'two-seat')
    expect(proposal.canApply).toBe(false)
    expect(proposal.issues.map(issue => issue.kind)).toEqual(['chair-clearance', 'chair-clearance', 'chair-clearance'])
    expect(proposal.issues.map(issue => issue.obstacleId).filter(Boolean).sort()).toEqual(['entry', 'wall:0'])
    expect(proposal.issues.some(issue => issue.itemIds.includes('cabinet'))).toBe(true)
    expect(code(() => store.applyProposal(proposal.id))).toBe('LAYOUT_CONFLICT')
    expect(readFileSync(path, 'utf8')).toBe(saved)
    expect(store.historyState().canUndo).toBe(false)
  })

  it('retains pullout clearance checks on later movement of the saved dining group', () => {
    const initial = diningProject()
    const { store, path } = opened({
      ...initial,
      keepouts: [{ id: 'entry', name: 'Entrance', polygon: [[100, 1150], [500, 1150], [500, 1300], [100, 1300]] }],
    })
    const proposal = store.proposeFourSeat(0, 'two-seat')
    expect(proposal.canApply).toBe(true)
    store.applyProposal(proposal.id)
    const reopened = new FileProjectStore(path)
    expect(code(() => reopened.move(1, ['two-seat'], 0, 100))).toBe('LAYOUT_CONFLICT')
    expect(reopened.read().revision).toBe(1)
  })

  it('uses the original round table position and orientation for the rectangular replacement', () => {
    const initial = diningProject()
    const source = { ...initial.state.furniture[0]!, type: 'roundtable', cx: 1200, cy: -700, w: 600, d: 600, rot: 35 }
    const { store, path } = opened({ ...initial, state: { ...initial.state, furniture: [source, ...initial.state.furniture.slice(1)] } })
    const proposal = store.proposeFourSeat(0, 'two-seat')
    expect(proposal.addedItems[0]).toMatchObject({ type: 'table', cx: 1200, cy: -700, w: 1200, d: 750, rot: 35 })
    store.applyProposal(proposal.id)
    const reopened = new FileProjectStore(path).read()
    expect(reopened.state.furniture).toEqual(proposal.addedItems)
    expect(code(() => parseProject({
      ...reopened,
      state: { ...reopened.state, furniture: [{ ...reopened.state.furniture[0], type: 'roundtable' }, ...reopened.state.furniture.slice(1)] },
    }))).toBe('PROJECT_INVALID')
  })

  it('rejects replaced, canceled or stale preview IDs and refuses arbitrary selections', () => {
    const { store, path } = opened(diningProject())
    const saved = readFileSync(path, 'utf8')
    expect(code(() => store.proposeFourSeat(0))).toBe('DINING_GROUP_REQUIRED')
    expect(code(() => store.proposeFourSeat(0, 'missing'))).toBe('DINING_GROUP_REQUIRED')
    const first = store.proposeFourSeat(0, 'two-seat')
    const latest = store.proposeFourSeat(0, 'two-seat')
    expect(code(() => store.applyProposal(first.id))).toBe('PROPOSAL_NOT_FOUND')
    expect(code(() => store.cancelProposal(first.id))).toBe('PROPOSAL_NOT_FOUND')
    store.cancelProposal(latest.id)
    expect(store.getProposal()).toBeNull()
    expect(readFileSync(path, 'utf8')).toBe(saved)
    const stale = store.proposeFourSeat(0, 'two-seat')
    store.move(0, ['two-seat'], 100, 0)
    expect(store.getProposal()).toBeNull()
    expect(code(() => store.applyProposal(stale.id))).toBe('REVISION_CONFLICT')
    expect(store.read().revision).toBe(1)
    expect(store.read().groups[0]!.itemIds).toEqual(stale.removedItemIds)
  })

  it('requires explicit chair members and rejects forged saved template geometry', () => {
    const initial = diningProject()
    const wrongGroup = { ...initial.groups[0]!, itemIds: ['table', 'chair-a'] }
    const { store } = opened({ ...initial, groups: [wrongGroup] })
    expect(code(() => store.proposeFourSeat(0, wrongGroup.id))).toBe('DINING_GROUP_INVALID')
    expect(code(() => parseProject({ ...initial, groups: [{ ...initial.groups[0], diningTemplate: 'rectangular-four-seat-v1' }] }))).toBe('PROJECT_INVALID')
  })
})
