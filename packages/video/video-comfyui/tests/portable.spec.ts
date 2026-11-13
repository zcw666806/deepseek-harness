import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { exportWorkflows, restoreWorkflows } from '../src/portable.ts'
import { workflow } from './fixture.ts'

describe('portable ComfyUI workflow settings', () => {
  it('preserves declarative model bindings and clears machine transport and operation inputs', () => {
    const source = workflow(1)
    const template = { '1': { class_type: 'OperatorVideo', _meta: { title: 'Private workstation' }, inputs: {
      text: 'Private prompt', seconds: 2, width: 854, height: 480, prefix: 'C:/private/output', ref0: 'C:/private/face.png', ckpt_name: 'model.safetensors',
    } } }
    const exported = exportWorkflows({ enabled: true, baseURL: 'http://private-machine:8188/', headers: { authorization: 'Bearer private' }, workflows: [{ ...source, template }] })
    const text = JSON.stringify(exported)
    for (const value of ['private-machine', 'Bearer private', 'Private prompt', 'C:/private', 'Private workstation']) expect(text).not.toContain(value)
    expect(text).toContain('model.safetensors')
    const restored = restoreWorkflows(exported, { baseURL: 'http://new-machine:8188/', headers: { authorization: 'target-only' } })
    expect(restored).toHaveLength(1)
    expect(restored[0]?.template['1']).toMatchObject({ inputs: { text: '', prefix: '', ref0: '', ckpt_name: 'model.safetensors' } })
    expect(restored[0]).not.toHaveProperty('revision')
  })

  it.each([
    { api_key: 'a-secret' }, { model: '/home/user/model.safetensors' }, { model: 'C:\\models\\video.safetensors' },
    { model: '../shared/model.safetensors' }, { endpoint: 'https://private.example/api' },
  ])('rejects unbound credentials or machine references: %j', (inputs) => {
    const base = workflow()
    const node = base.template['1'] as { class_type: string; inputs: Record<string, JsonValue> }
    expect(() => exportWorkflows({ workflows: [{ ...base, template: { '1': { ...node, inputs: { ...node.inputs, ...inputs } } } }] })).toThrow()
  })

  it('rejects malformed bindings and unsupported manifest fields without changing target settings', () => {
    const machine = { enabled: false, baseURL: 'http://target.invalid/', headers: { authorization: 'target-only' } }
    expect(() => restoreWorkflows({ version: 2, workflows: [] }, machine)).toThrow()
    expect(() => restoreWorkflows({ version: 1, workflows: [], endpoint: 'other' }, machine)).toThrow()
    expect(() => restoreWorkflows({ version: 1, workflows: [{ id: 'broken' }] }, machine)).toThrow()
    expect(machine).toEqual({ enabled: false, baseURL: 'http://target.invalid/', headers: { authorization: 'target-only' } })
  })

  it.each([
    ['token', 'private-token'], ['api_token', 'private-token'], ['refresh_token', 'private-token'],
    ['bearer_token', 'private-token'], ['auth_token', 'private-token'], ['accessToken', 'private-token'],
    ['oauth_access_token', 'private-token'], ['personal_access_token', 'private-token'],
    ['hf_token', 'private-token'], ['client_token', 'private-token'],
    ['AUTH-TOKEN', 'private-token'], ['api_key', 123456], ['password', true],
    ['client_secret', { value: 'private-token' }], ['credential', ['private-token']], ['token', null],
  ])('rejects credential field %s on export and restoration regardless of value type', (field, value) => {
    const base = workflow()
    const node = base.template['1'] as { class_type: string; inputs: Record<string, JsonValue> }
    const candidate = { ...base, template: { '1': { ...node, inputs: { ...node.inputs, [field]: value } } } }
    expect(() => exportWorkflows({ workflows: [candidate] })).toThrow('Workflow credentials')
    const imported = JSON.parse(JSON.stringify({ version: 1, workflows: [candidate] })) as JsonValue
    expect(() => restoreWorkflows(imported, {})).toThrow('Workflow credentials')
  })

  it('retains generation token limits and token arrays', () => {
    const base = workflow()
    const node = base.template['1'] as { class_type: string; inputs: Record<string, JsonValue> }
    const template = { '1': { ...node, inputs: { ...node.inputs, max_tokens: 1024, tokens: [1, 2], tokenizer: 'local-model' } } }
    const exported = exportWorkflows({ workflows: [{ ...base, template }] })
    expect(restoreWorkflows(exported, {})[0]?.template['1']).toMatchObject({ inputs: { max_tokens: 1024, tokens: [1, 2], tokenizer: 'local-model' } })
  })
})
