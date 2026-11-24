/** Canvas-space image paths retain a clear lane around their shot's prompt. */
import { describe, expect, it } from 'vitest'
import { referenceLanePath } from '../src/client/ReferenceEdge.tsx'

describe('reference connection routing', () => {
  it('passes below the prompt when both image handles are horizontally aligned', () => {
    const prompt = { x: 336, y: 64, width: 272, height: 290 }
    const lane = referenceLanePath({ sourceX: 304, sourceY: 304, targetX: 640, targetY: 304 }, prompt)
    expect(lane.labelY).toBeGreaterThan(prompt.y + prompt.height)
    expect(lane.path).toContain('M 304,304 C 320,304 320,370 320,370')
    expect(lane.path).toContain('L 624,370 C 624,370 624,304 640,304')
    expect(lane.labelX).toBeGreaterThan(prompt.x)
    expect(lane.labelX).toBeLessThan(prompt.x + prompt.width)
  })

  it('repositions the lane when the prompt is dragged and its measured height grows', () => {
    const handles = { sourceX: 304, sourceY: 304, targetX: 640, targetY: 304 }
    const initial = referenceLanePath(handles, { x: 336, y: 64, width: 272, height: 290 })
    const moved = referenceLanePath(handles, { x: 280, y: 160, width: 272, height: 350 })
    expect(moved.labelY).toBe(526)
    expect(moved.path).toContain('C 264,304 264,526 264,526')
    expect(moved.path).not.toBe(initial.path)
    expect(moved.path).toContain('640,304')
  })
})
