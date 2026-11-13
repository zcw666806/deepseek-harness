import { describe, expect, it } from 'vitest'
import { checkLayout, doorSwingPolygon, furniturePolygon, isConvexPolygon, polygonOverlap } from '../src/geometry.ts'
import type { Furniture, Point, Project } from '../src/types.ts'

const item = (id: string, cx: number, cy: number, w = 100, d = 100, rot = 0): Furniture => ({ id, type: 'table', name: id, cx, cy, w, d, rot, color: '#abcdef' })
const rectangle = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const project = (furniture: Furniture[]): Project => ({ formatVersion: 1, revision: 0, title: 'Restaurant', base: { walls: [], windows: [], doors: [], slides: [], rooms: [], bounds: { x: -2000, y: -2000, w: 4000, h: 4000 } }, state: { furniture, rooms: {}, demolished: [], measures: [] }, groups: [], keepouts: [] })

describe('restaurant plan geometry', () => {
  it('measures true rotated footprints instead of their axis-aligned bounds', () => {
    const first = furniturePolygon(item('a', 0, 0, 1000, 20, 45))
    const separated = furniturePolygon(item('b', 0, 100, 1000, 20, 45))
    expect(polygonOverlap(first, separated)).toBeUndefined()
    const crossing = furniturePolygon(item('c', 0, 0, 1000, 20, -45))
    expect(polygonOverlap(first, crossing)?.areaMm2).toBeCloseTo(400)
  })

  it('treats touching edges as free and reports containment penetration', () => {
    expect(polygonOverlap(rectangle(0, 0, 100, 100), rectangle(100, 0, 200, 100))).toBeUndefined()
    expect(polygonOverlap(rectangle(20, 20, 40, 40), rectangle(0, 0, 100, 100))).toEqual({ depthMm: 40, areaMm2: 400 })
    expect(polygonOverlap(rectangle(20, 20, 40, 40).reverse(), rectangle(0, 0, 100, 100))?.areaMm2).toBe(400)
    expect(polygonOverlap(rectangle(0, 0, 0, 100), rectangle(0, 0, 100, 100))).toBeUndefined()
  })

  it('accepts clockwise convex keepouts but refuses concave, crossing and degenerate polygons', () => {
    expect(isConvexPolygon(rectangle(0, 0, 100, 100).reverse())).toBe(true)
    expect(isConvexPolygon([[0, 0], [100, 0], [20, 20], [100, 100], [0, 100]])).toBe(false)
    expect(isConvexPolygon([[0, 0], [100, 100], [0, 100], [100, 0]])).toBe(false)
    expect(isConvexPolygon([[0, 0], [50, 0], [100, 0]])).toBe(false)
    expect(isConvexPolygon([[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]])).toBe(false)
  })

  it('checks opening space with a conservative door sector and excludes the opposite side', () => {
    const door = { name: 'Entry', rect: [0, -10, 1000, 10] as const, h: [0, 0] as const, c: [1, 0] as const, o: [0, 1] as const, len: 1000 }
    const swing = doorSwingPolygon(door)
    expect(polygonOverlap(furniturePolygon(item('inside', 700, 700, 50, 50)), swing)).toBeDefined()
    expect(polygonOverlap(furniturePolygon(item('opposite', 700, -700, 50, 50)), swing)).toBeUndefined()
    const value = project([item('inside', 700, 700)])
    expect(checkLayout({ ...value, base: { ...value.base, doors: [door] } }).map(issue => issue.kind)).toEqual(['door'])
  })

  it('reports obstacles, bounds and manual keepouts with stable identities', () => {
    const initial = project([item('a', 0, 0), item('b', 25, 0), item('outside', 2050, 0)])
    const value: Project = { ...initial,
      base: { ...initial.base, walls: [[-10, -100, 10, 100, 'b']], windows: [[-100, -10, 100, 10]] },
      keepouts: [{ id: 'entry', name: 'Entry corridor', polygon: rectangle(-100, -100, 100, 100) }],
    }
    const issues = checkLayout(value)
    expect(new Set(issues.map(issue => issue.kind))).toEqual(new Set(['wall', 'window', 'furniture', 'keepout', 'bounds']))
    expect(issues.find(issue => issue.kind === 'keepout')?.obstacleId).toBe('entry')
    expect(issues.find(issue => issue.kind === 'bounds')?.overlapMm).toBe(100)
    expect(new Set(issues.map(issue => issue.key)).size).toBe(issues.length)
  })

  it('permits intentional internal group overlaps while retaining outside collisions', () => {
    const initial = project([item('table', 0, 0), item('chair', 25, 0), item('cabinet', 0, 25)])
    const value = { ...initial, groups: [{ id: 'group', name: 'Table and chair', itemIds: ['table', 'chair'] }] }
    const issues = checkLayout(value)
    expect(issues).toHaveLength(2)
    expect(issues.every(issue => issue.itemIds.includes('cabinet'))).toBe(true)
  })
})
