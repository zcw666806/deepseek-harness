// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { WorkflowSection, type WorkflowSectionProps } from '../src/client/WorkflowSection.tsx'
import type { WorkflowSnapshot } from '../src/client/workflow-controller.ts'
import { zh } from '../src/client/locales.ts'
import type { ComfyWorkflow } from '@deepseek-ai/dsh-video-comfyui/types'
import type {} from '../src/client/mount.ts'
import { settingsRuntimeProps } from './fixtures.client.ts'

afterEach(cleanup)
function props(state: WorkflowSnapshot): WorkflowSectionProps {
  return {
    ...settingsRuntimeProps(),
    t: makeTranslate(zh, commonZh), useWorkflows: selector => selector(state),
    loadWorkflows: vi.fn(), validateWorkflows: vi.fn(), saveWorkflows: vi.fn(), enableWorkflows: vi.fn(),
  }
}
const state: WorkflowSnapshot = {
  view: { revision: 1, enabled: false, hasHeaders: true, templates: [], configuration: { baseURL: 'http://localhost:8188', workflows: [] } },
  requested: true, busy: false, validated: false, error: null,
}
describe('workflow settings editor', () => {
  it('adds a diagnostic template only to the draft and labels it as non-AI', () => {
    const binding = { node: '1', input: 'value' }
    const workflow: ComfyWorkflow = {
      id: 'diagnostic', title: 'Diagnostic', template: {}, prompt: binding,
      duration: { ...binding, unit: 'seconds' }, width: binding, height: binding,
      references: [], outputPrefix: binding, durations: [1],
      sizes: [{ aspectRatio: '1:1', resolution: '480p', width: 480, height: 480 }],
      output: { node: '1', key: 'images', index: 0 },
    }
    const value = props({ ...state, view: { ...state.view!, templates: [{ category: 'diagnostic', workflow }] } })
    render(<WorkflowSection {...value} />)
    fireEvent.click(screen.getByRole('button', { name: '添加黑帧传输诊断（非 AI 生成）' }))
    expect(screen.getByLabelText<HTMLInputElement>('目标标识').value).toBe('diagnostic')
    expect(value.saveWorkflows).not.toHaveBeenCalled()
    expect(value.enableWorkflows).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存并禁用' }))
    expect(value.saveWorkflows).toHaveBeenCalledWith({ baseURL: 'http://localhost:8188', workflows: [workflow] })
  })
  it('retains rejected drafts and requires saved configuration before enabling', () => {
    const value = props(state)
    const rendered = render(<WorkflowSection {...value} />)
    fireEvent.click(screen.getByRole('button', { name: '新增工作流' }))
    fireEvent.change(screen.getByLabelText('目标名称'), { target: { value: 'My model' } })
    fireEvent.change(screen.getByLabelText('目标标识'), { target: { value: 'my-model' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并禁用' }))
    expect(value.saveWorkflows).toHaveBeenCalledWith(expect.objectContaining({ workflows: [expect.objectContaining({ title: 'My model', id: 'my-model' })] }))
    expect(value.enableWorkflows).not.toHaveBeenCalled()
    rendered.rerender(<WorkflowSection {...value} useWorkflows={selector => selector({ ...state, error: 'Missing prompt input' })} />)
    expect(screen.getByRole('alert').textContent).toContain('Missing prompt input')
    expect(screen.getByLabelText<HTMLInputElement>('目标名称').value).toBe('My model')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '启用工作流' }).disabled).toBe(true)
  })
  it('rejects malformed mapping JSON before calling Host validation', () => {
    const value = props(state)
    render(<WorkflowSection {...value} />)
    fireEvent.click(screen.getByRole('button', { name: '新增工作流' }))
    fireEvent.change(screen.getByLabelText('提示词映射'), { target: { value: '{' } })
    fireEvent.click(screen.getByRole('button', { name: '校验工作流' }))
    expect(screen.getByRole('alert').textContent).toContain('JSON')
    expect(value.validateWorkflows).not.toHaveBeenCalled()
    expect(screen.getByLabelText<HTMLTextAreaElement>('提示词映射').value).toBe('{')
    expect(screen.getByText('服务已配置请求头；此处不显示其值。')).toBeTruthy()
  })
})
