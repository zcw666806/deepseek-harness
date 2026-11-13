/** Deterministic plan-view overlaps for furniture, fixed construction and designated keepouts. */
import { fourSeatTemplate } from './dining.ts'
import type { ChairEnvelope, Door, Furniture, LayoutIssue, Point, Project, Rect } from './types.ts'

const EPSILON = 1e-6

function cross(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function signedArea(polygon: readonly Point[]): number {
  return polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length]!
    return sum + point[0] * next[1] - point[1] * next[0]
  }, 0) / 2
}

/**
 * Checks the convex, non-degenerate polygon requirement for manual keepouts.
 * @param polygon - Ordered perimeter vertices, without a repeated closing vertex.
 * @returns Whether every turn has one orientation and the area is nonzero.
 */
export function isConvexPolygon(polygon: readonly Point[]): boolean {
  if (polygon.length < 3 || Math.abs(signedArea(polygon)) <= EPSILON) return false
  let direction = 0
  for (let index = 0; index < polygon.length; index++) {
    const turn = cross(polygon[index]!, polygon[(index + 1) % polygon.length]!, polygon[(index + 2) % polygon.length]!)
    if (Math.abs(turn) <= EPSILON) continue
    if (direction !== 0 && Math.sign(turn) !== direction) return false
    direction = Math.sign(turn)
  }
  const orientation = Math.sign(signedArea(polygon))
  return direction !== 0 && new Set(polygon.map(point => JSON.stringify(point))).size === polygon.length
    && polygon.every((start, index) => polygon.every(point => orientation * cross(start, polygon[(index + 1) % polygon.length]!, point) >= -EPSILON))
}

/**
 * Projects a rotated furniture footprint into the plan.
 * @param item - Furniture with a centre, dimensions and rotation in degrees.
 * @returns Four ordered footprint vertices in millimetres.
 */
export function furniturePolygon(item: Furniture): Point[] {
  const radians = item.rot * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return ([[-item.w / 2, -item.d / 2], [item.w / 2, -item.d / 2], [item.w / 2, item.d / 2], [-item.w / 2, item.d / 2]] as Point[])
    .map(([x, y]) => [item.cx + x * cosine - y * sine, item.cy + x * sine + y * cosine])
}

function rectanglePolygon([x0, y0, x1, y1]: Rect): Point[] {
  return [[Math.min(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.max(y0, y1)], [Math.min(x0, x1), Math.max(y0, y1)]]
}

/**
 * Builds an outer approximation of a hinged door's swept sector.
 * @param door - Source hinge, closed/open directions and door length.
 * @returns A convex perimeter using tangent segments no more than five degrees apart.
 */
export function doorSwingPolygon(door: Door): Point[] {
  const start = Math.atan2(door.c[1], door.c[0])
  const end = Math.atan2(door.o[1], door.o[0])
  const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start))
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 36)))
  const step = delta / steps
  const at = (angle: number, radius: number): Point => [door.h[0] + Math.cos(angle) * radius, door.h[1] + Math.sin(angle) * radius]
  const result: Point[] = [door.h, at(start, door.len)]
  for (let index = 0; index < steps; index++) {
    result.push(at(start + (index + 0.5) * step, door.len / Math.cos(step / 2)))
  }
  result.push(at(end, door.len))
  return result
}

function intersection(subject: readonly Point[], clip: readonly Point[]): Point[] {
  let output = [...subject]
  const orientation = Math.sign(signedArea(clip))
  for (let index = 0; index < clip.length && output.length > 0; index++) {
    const a = clip[index]!
    const b = clip[(index + 1) % clip.length]!
    const input = output
    output = []
    let previous = input[input.length - 1]!
    let previousDistance = orientation * cross(a, b, previous)
    for (const current of input) {
      const currentDistance = orientation * cross(a, b, current)
      if ((currentDistance >= -EPSILON) !== (previousDistance >= -EPSILON)) {
        const fraction = previousDistance / (previousDistance - currentDistance)
        output.push([previous[0] + (current[0] - previous[0]) * fraction, previous[1] + (current[1] - previous[1]) * fraction])
      }
      if (currentDistance >= -EPSILON) output.push(current)
      previous = current
      previousDistance = currentDistance
    }
  }
  return output
}

/**
 * Measures overlap of two convex polygons; touching edges have no overlap.
 * @param a - First convex perimeter.
 * @param b - Second convex perimeter.
 * @returns Penetration depth and intersection area, or undefined for disjoint polygons.
 */
export function polygonOverlap(a: readonly Point[], b: readonly Point[]): { depthMm: number; areaMm2: number } | undefined {
  if (Math.abs(signedArea(a)) <= EPSILON || Math.abs(signedArea(b)) <= EPSILON) return undefined
  let depthMm = Infinity
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index++) {
      const start = polygon[index]!
      const end = polygon[(index + 1) % polygon.length]!
      const length = Math.hypot(end[0] - start[0], end[1] - start[1])
      if (length <= EPSILON) continue
      const axis: Point = [(end[1] - start[1]) / length, (start[0] - end[0]) / length]
      const first = a.map(point => point[0] * axis[0] + point[1] * axis[1])
      const second = b.map(point => point[0] * axis[0] + point[1] * axis[1])
      const overlap = Math.min(Math.max(...first) - Math.min(...second), Math.max(...second) - Math.min(...first))
      if (overlap <= EPSILON) return undefined
      depthMm = Math.min(depthMm, overlap)
    }
  }
  const areaMm2 = Math.abs(signedArea(intersection(a, b)))
  return areaMm2 > EPSILON ? { depthMm, areaMm2 } : undefined
}

/**
 * Projects each template chair's entire outward sweep into the plan.
 * @param project - Validated project containing the applied dining template.
 * @param groupId - Group to include, or all template groups when omitted.
 * @returns The footprint swept out by each included chair.
 */
export function chairEnvelopes(project: Project, groupId?: string): ChairEnvelope[] {
  const items = new Map(project.state.furniture.map(item => [item.id, item]))
  const result: ChairEnvelope[] = []
  for (const group of project.groups) {
    if (group.diningTemplate !== fourSeatTemplate.id || (groupId !== undefined && group.id !== groupId)) continue
    for (const itemId of group.itemIds.slice(1)) {
      const chair = items.get(itemId)!
      const radians = chair.rot * Math.PI / 180
      const pullout = fourSeatTemplate.chairPulloutMm
      result.push({ itemId, polygon: furniturePolygon({
        ...chair,
        cx: chair.cx + Math.sin(radians) * pullout / 2,
        cy: chair.cy - Math.cos(radians) * pullout / 2,
        d: chair.d + pullout,
      }) })
    }
  }
  return result
}

type FixedKind = 'wall' | 'window' | 'door' | 'keepout'
interface Obstacle { readonly kind: FixedKind; readonly id: string; readonly polygon: readonly Point[] }

function fixedObstacles(project: Project): Obstacle[] {
  const { base, state, keepouts } = project
  const obstacles: Obstacle[] = []
  const demolished = new Set(state.demolished)
  base.walls.forEach(([x0, y0, x1, y1], index) => {
    if (!demolished.has(`w${index}`)) obstacles.push({ kind: 'wall', id: `wall:${index}`, polygon: rectanglePolygon([x0, y0, x1, y1]) })
  })
  base.windows.forEach((window, index) => obstacles.push({ kind: 'window', id: `window:${index}`, polygon: rectanglePolygon(window) }))
  base.doors.forEach((door, index) => obstacles.push({ kind: 'door', id: `door:${index}`, polygon: doorSwingPolygon(door) }))
  keepouts.forEach(keepout => obstacles.push({ kind: 'keepout', id: keepout.id, polygon: keepout.polygon }))
  return obstacles
}

function outsideBounds(bounds: Project['base']['bounds'], polygon: readonly Point[]): { depthMm: number; areaMm2: number } | undefined {
  const depthMm = Math.max(0, ...polygon.flatMap(([x, y]) => [bounds.x - x, x - bounds.x - bounds.w, bounds.y - y, y - bounds.y - bounds.h]))
  if (depthMm <= EPSILON) return undefined
  const inside = intersection(polygon, rectanglePolygon([bounds.x, bounds.y, bounds.x + bounds.w, bounds.y + bounds.h]))
  return { depthMm, areaMm2: Math.max(0, Math.abs(signedArea(polygon)) - Math.abs(signedArea(inside))) }
}

/**
 * Reports current plan overlaps, preserving existing imported defects as issues.
 * @param project - Complete validated project; groups permit their members' internal overlap.
 * @returns Stable issues suitable for comparing the current and proposed layouts.
 */
export function checkLayout(project: Project): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const items = project.state.furniture
  const footprints = items.map(furniturePolygon)
  const memberships = new Map(project.groups.flatMap(group => group.itemIds.map(id => [id, group.id] as const)))
  const obstacles = fixedObstacles(project)
  const add = (kind: LayoutIssue['kind'], itemIds: string[], obstacleId: string | undefined, a: readonly Point[], b: readonly Point[]) => {
    const overlap = polygonOverlap(a, b)
    if (overlap === undefined) return
    const orderedIds = [...itemIds].sort()
    issues.push({
      key: JSON.stringify([kind, orderedIds, obstacleId ?? null]), kind, itemIds: orderedIds,
      ...(obstacleId === undefined ? {} : { obstacleId }),
      overlapMm: overlap.depthMm, overlapAreaMm2: overlap.areaMm2,
      message: `${orderedIds.join(', ')} overlaps ${obstacleId ?? 'another furniture item'}.`,
    })
  }
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    const footprint = footprints[index]!
    for (let other = index + 1; other < items.length; other++) {
      const next = items[other]!
      if (memberships.has(item.id) && memberships.get(item.id) === memberships.get(next.id)) continue
      add('furniture', [item.id, next.id], undefined, footprint, footprints[other]!)
    }
    for (const obstacle of obstacles) add(obstacle.kind, [item.id], obstacle.id, footprint, obstacle.polygon)
    const outside = outsideBounds(project.base.bounds, footprint)
    if (outside !== undefined) {
      issues.push({ key: JSON.stringify(['bounds', item.id]), kind: 'bounds', itemIds: [item.id], overlapMm: outside.depthMm,
        overlapAreaMm2: outside.areaMm2, message: `${item.id} extends outside the source plan bounds.` })
    }
  }
  for (const { itemId, polygon } of chairEnvelopes(project)) {
    const addClearance = (targetKind: string, targetId: string, neighborId: string | undefined, overlap: ReturnType<typeof polygonOverlap>) => {
      if (overlap === undefined) return
      issues.push({
        key: JSON.stringify(['chair-clearance', itemId, targetKind, targetId]), kind: 'chair-clearance',
        itemIds: neighborId === undefined ? [itemId] : [itemId, neighborId],
        ...(neighborId === undefined ? { obstacleId: targetId } : {}),
        overlapMm: overlap.depthMm, overlapAreaMm2: overlap.areaMm2,
        message: `Chair ${itemId} needs pullout space at ${targetId}.`,
      })
    }
    const groupId = memberships.get(itemId)
    for (let index = 0; index < items.length; index++) {
      const neighborId = items[index]!.id
      if (memberships.get(neighborId) === groupId) continue
      addClearance('furniture', neighborId, neighborId, polygonOverlap(polygon, footprints[index]!))
    }
    for (const obstacle of obstacles) addClearance(obstacle.kind, obstacle.id, undefined, polygonOverlap(polygon, obstacle.polygon))
    addClearance('bounds', 'plan bounds', undefined, outsideBounds(project.base.bounds, polygon))
  }
  return issues.sort((a, b) => a.key.localeCompare(b.key))
}
