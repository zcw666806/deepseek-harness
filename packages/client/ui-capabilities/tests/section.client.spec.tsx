// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { CapabilitySection, type CapabilitySectionProps } from '../src/client/CapabilitySection.tsx'
import type { CapabilitySnapshot } from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'
import type {} from '../src/client/mount.ts'
import { capability, ID, settingsRuntimeProps } from './fixtures.client.ts'

afterEach(cleanup)
function props(state: CapabilitySnapshot): CapabilitySectionProps {
  return {
    ...settingsRuntimeProps(),
    exportManifest: vi.fn(), restoreFile: vi.fn(), applyRestoration: vi.fn(), discardRestoration: vi.fn(),
    t: makeTranslate(zh, commonZh), useCapabilities: selector => selector(state),
    refresh: vi.fn(), perform: vi.fn(), cancel: vi.fn() }
}
describe('capability settings section', () => {
  it('shows compatibility separately from readiness and waits for explicit application', () => {
    const value = props({ items: [capability], operation: null, manifestDownload: null, restorations: [],
      restorePlan: { items: [{ id: ID, expectedEngineId: 'comfyui', expectedVersion: '0.43.0',
        status: 'compatible', configuration: 'pending-validation', current: capability }] },
      requested: true, cancelling: false, error: null })
    render(<CapabilitySection {...value} />)
    expect(screen.getByText('身份与版本匹配')).toBeTruthy()
    expect(screen.getByText('设置将在应用时验证')).toBeTruthy()
    expect(screen.getByText('当前状态：缺少依赖')).toBeTruthy()
    expect(value.applyRestoration).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '应用配置' }))
    expect(value.applyRestoration).toHaveBeenCalledOnce()
    expect(value.perform).not.toHaveBeenCalled()
  })
  it('shows missing requirements and exposes only the Host-advertised actions', () => {
    const value = props({ items: [capability], operation: null, manifestDownload: null, restorations: [], restorePlan: null,
      requested: true, cancelling: false, error: null })
    render(<CapabilitySection {...value} />)
    expect(screen.getByText('Private runtime')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '启动' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '准备' }))
    expect(value.perform).toHaveBeenCalledExactlyOnceWith(ID, 'prepare')
  })
  it('does not stop an externally managed local service', () => {
    const value = props({ items: [{ ...capability, owned: false, status: 'ready', actions: ['check', 'stop'] }],
      operation: null, manifestDownload: null, restorations: [], restorePlan: null, requested: true, cancelling: false, error: null })
    render(<CapabilitySection {...value} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '停止' }).disabled).toBe(true)
    expect(screen.getByText('只有由 DSH 启动的本地服务才能在此停止。')).toBeTruthy()
  })

  it('disables other actions during cancellation and does not restart a cancelled initial read', () => {
    const state: CapabilitySnapshot = { items: [capability], manifestDownload: null, restorations: [], restorePlan: null,
      requested: true,
      operation: { kind: 'action', id: ID, action: 'prepare' }, cancelling: true, error: null }
    const value = props(state)
    const rendered = render(<CapabilitySection {...value} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '检查' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '取消操作' }).disabled).toBe(true)
    rendered.rerender(<CapabilitySection
      {...props({ ...state, items: null, operation: null, cancelling: false })} refresh={value.refresh}
    />)
    expect(value.refresh).not.toHaveBeenCalled()
  })
})
