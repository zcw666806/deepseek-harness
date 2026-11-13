/** The approved four-seat planning template and its table-relative placement. */
import type { DiningTemplate, Furniture, Point } from './types.ts'

/** Planning dimensions of one versioned template, in millimetres. */
export const fourSeatTemplate: DiningTemplate = Object.freeze({
  id: 'rectangular-four-seat-v1',
  tableWidthMm: 1200,
  tableDepthMm: 750,
  chairWidthMm: 450,
  chairDepthMm: 450,
  chairPulloutMm: 300,
})

const tolerance = 1e-6

function tablePoint(table: Furniture, x: number, y: number): Point {
  const radians = table.rot * Math.PI / 180
  return [
    table.cx + x * Math.cos(radians) - y * Math.sin(radians),
    table.cy + x * Math.sin(radians) + y * Math.cos(radians),
  ]
}

/**
 * Locates a supported dining table among the exact number of chair members.
 * @param members - Explicit furniture group members.
 * @param seatCount - Required number of individual chairs.
 * @returns The sole supported table. Two-seat source groups also accept round tables.
 */
export function diningTable(members: readonly Furniture[], seatCount: 2 | 4): Furniture | undefined {
  if (members.length !== seatCount + 1 || members.filter(item => item.type === 'chair').length !== seatCount) return undefined
  return members.find(item => item.type === 'table' || item.type === 'diningtable' || (seatCount === 2 && item.type === 'roundtable'))
}

/**
 * Places the template around the source table centre and rotation.
 * @param table - Recognized source table.
 * @param chairColor - Color of a source chair, reused for all four chairs.
 * @param id - Fresh identity for the replacement component at the given index.
 * @returns The table followed by two chairs on each long side.
 */
export function placeFourSeat(table: Furniture, chairColor: string, id: (index: number) => string): Furniture[] {
  const { tableWidthMm, tableDepthMm, chairWidthMm, chairDepthMm } = fourSeatTemplate
  const replacement: Furniture = {
    id: id(0), type: 'table', name: '四人餐桌',
    cx: table.cx, cy: table.cy, w: tableWidthMm, d: tableDepthMm, rot: table.rot, color: table.color,
  }
  const chairs = ([-1, 1] as const).flatMap((side, sideIndex) => ([-1, 1] as const).map((column, columnIndex): Furniture => {
    const [cx, cy] = tablePoint(table, column * tableWidthMm / 4, side * (tableDepthMm + chairDepthMm) / 2)
    return {
      id: id(1 + sideIndex * 2 + columnIndex), type: 'chair', name: '餐椅',
      cx, cy, w: chairWidthMm, d: chairDepthMm, rot: table.rot + (side === -1 ? 0 : 180), color: chairColor,
    }
  }))
  return [replacement, ...chairs]
}

/**
 * Checks saved template members before using the template's chair clearances.
 * @param members - Members in the applied template's recorded order.
 * @returns Whether the ordered members match the template's dimensions and relative placements.
 */
export function matchesFourSeatTemplate(members: readonly Furniture[]): boolean {
  const table = diningTable(members, 4)
  if (table === undefined || table.id !== members[0]?.id) return false
  return placeFourSeat(table, '', index => members[index]!.id).every((expected, index) => {
    const item = members[index]!
    return item.type === expected.type && item.w === expected.w && item.d === expected.d && item.rot === expected.rot
      && Math.abs(item.cx - expected.cx) <= tolerance && Math.abs(item.cy - expected.cy) <= tolerance
  })
}
