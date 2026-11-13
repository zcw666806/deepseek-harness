// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ReaExperimentCard, type ReaExperimentCardProps } from '../src/client/ReaExperimentCard.tsx'
import type { ReaExperimentCardState } from '../src/client/rea-experiment-card-controller.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

function bench(overrides: Partial<ReaExperimentCardState> = {}, dictionary = en) {
  const store = createSnapshotStore<ReaExperimentCardState>({
    available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
    enabled: false, command: 'npx', args: '["--yes","rea-agents@6.7.0","mcp"]',
    toolCallTimeoutMs: '600000', commandInvalid: false, argsInvalid: false, timeoutInvalid: false,
    conflicted: false, ...overrides,
  })
  const actions = { toggleEnabled: vi.fn(), edit: vi.fn(), save: vi.fn(), discard: vi.fn() }
  const props = {
    ...actions,
    t: (key: keyof typeof en) => dictionary[key],
    useReaExperimentCard: bindSnapshotSelector(store),
  } as unknown as ReaExperimentCardProps
  render(<ReaExperimentCard {...props} />)
  return { actions, store }
}

describe('ReaExperimentCard', () => {
  it('renders a default-off switch and the new-chat and startup-failure notices', () => {
    const { actions } = bench()
    fireEvent.click(screen.getByText(en.reaTitle))
    const toggle = screen.getByRole('switch', { name: en.reaToggle })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(actions.toggleEnabled).toHaveBeenCalledOnce()
    expect(screen.getByText(en.reaNewChats)).toBeTruthy()
    expect(screen.getByText(en.reaStartupFailure)).toBeTruthy()
    expect(screen.getByText(en.reaLocalAccess)).toBeTruthy()
    expect(screen.getByText(en.reaAdvanced).closest('details')?.open).toBe(false)
    expect(screen.getByLabelText<HTMLInputElement>(en.reaCommand).disabled).toBe(true)
  })

  it('stages each advanced field and invokes explicit save or discard', () => {
    const { actions } = bench({ enabled: true, dirty: true })
    fireEvent.click(screen.getByText(en.reaTitle))
    fireEvent.click(screen.getByText(en.reaAdvanced))
    fireEvent.change(screen.getByLabelText(en.reaCommand), { target: { value: 'rea' } })
    fireEvent.change(screen.getByLabelText(en.reaArgs), { target: { value: '["mcp"]' } })
    fireEvent.change(screen.getByLabelText(en.reaTimeout), { target: { value: '120000' } })
    expect(actions.edit.mock.calls).toEqual([
      ['command', 'rea'], ['args', '["mcp"]'], ['toolCallTimeoutMs', '120000'],
    ])
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    fireEvent.click(screen.getByRole('button', { name: en.discard }))
    expect(actions.save).toHaveBeenCalledOnce()
    expect(actions.discard).toHaveBeenCalledOnce()
  })

  it('shows localized validation and conflict messages without claiming a connection', () => {
    bench({
      enabled: true, dirty: true, invalid: true,
      commandInvalid: true, argsInvalid: true, timeoutInvalid: true, conflicted: true,
    }, zh)
    fireEvent.click(screen.getByText(zh.reaTitle))
    expect(screen.getByText(zh.reaCommandInvalid)).toBeTruthy()
    expect(screen.getByText(zh.reaArgsInvalid)).toBeTruthy()
    expect(screen.getByText(zh.reaTimeoutInvalid)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(zh.reaConflict)
    expect(screen.getByLabelText(zh.reaArgs).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.save }).disabled).toBe(true)
  })

  it('hides unavailable settings and disables read-only or saving controls', () => {
    bench({ available: false })
    expect(screen.queryByText(en.reaTitle)).toBeNull()
    cleanup()
    bench({ writable: false, enabled: true })
    fireEvent.click(screen.getByText(en.reaTitle))
    expect(screen.getByRole<HTMLButtonElement>('switch').disabled).toBe(true)
    expect(screen.getByLabelText<HTMLTextAreaElement>(en.reaArgs).disabled).toBe(true)
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    cleanup()
    bench({ saving: true, enabled: true, dirty: true })
    fireEvent.click(screen.getByText(en.reaTitle))
    expect(screen.getByRole<HTMLButtonElement>('switch').disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(en.reaTimeout).disabled).toBe(true)
    expect(screen.getByText(en.saving)).toBeTruthy()
  })
})
