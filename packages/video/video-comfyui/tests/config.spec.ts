import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { workflow } from './fixture.ts'
import type { ComfyWorkflow } from '../src/types.ts'

describe('operator-owned ComfyUI configuration', () => {
  it('defaults to disabled without requiring an endpoint or templates', () => {
    expect(resolveConfig({})).toMatchObject({ enabled: false, baseURL: undefined, workflows: [] })
  })

  it('rejects frontend graphs, nonexistent or linked scalar bindings, and duplicate inputs', () => {
    const enabled = { enabled: true, baseURL: 'http://operator.invalid/' }
    expect(() => resolveConfig({ ...enabled, workflows: [{ ...workflow(), template: { nodes: [], links: [] } }] })).toThrow()
    expect(() => resolveConfig({ ...enabled, workflows: [{ ...workflow(), prompt: { node: 'missing', input: 'text' } }] })).toThrow('existing string')
    expect(() => resolveConfig({ ...enabled, workflows: [{ ...workflow(), template: { '1': { class_type: 'Video', inputs: { text: ['2', 0] } } } }] })).toThrow('existing string')
    expect(() => resolveConfig({ ...enabled, workflows: [{ ...workflow(), height: workflow().width }] })).toThrow('distinct')
    expect(() => resolveConfig({ ...enabled, workflows: [{ ...workflow(), template: JSON.parse('{"__proto__":{}}') as ComfyWorkflow['template'] }] })).toThrow()
  })

  it('validates explicit duration units, dimension pairs, transport settings and revision changes', () => {
    const enabled = { enabled: true, baseURL: 'http://operator.invalid/' }
    const base = resolveConfig({ ...enabled, workflows: [workflow()] })
    const frames = resolveConfig({ ...enabled, workflows: [{ ...workflow(), duration: { ...workflow().duration, unit: 'frames', fps: 24 } }] })
    expect(frames.workflows[0]!.revision).not.toBe(base.workflows[0]!.revision)
    expect(() => resolveConfig({ ...enabled, workflows: [{ ...workflow(), duration: { ...workflow().duration, unit: 'frames' } }] })).toThrow('fps')
    expect(() => resolveConfig({ ...enabled, workflows: [{ ...workflow(), duration: { ...workflow().duration, fps: 24 } }] })).toThrow('omit fps')
    expect(() => resolveConfig({ ...enabled, workflows: [{ ...workflow(), sizes: [...workflow().sizes, ...workflow().sizes] }] })).toThrow('unique')
    expect(() => resolveConfig({ ...enabled, headers: { Host: 'another.invalid' }, workflows: [workflow()] })).toThrow('transport-owned')
    expect(() => resolveConfig({ ...enabled, baseURL: 'http://user:secret@operator.invalid/', workflows: [workflow()] })).toThrow('without credentials')
    expect(() => resolveConfig({ ...enabled, timeoutMs: 0, workflows: [workflow()] })).toThrow()
    expect(() => resolveConfig({ ...enabled, workflows: [] })).toThrow('nonempty')
  })
})
