/** Atomic REA settings edits, validation, and connection-owned drafts. */

import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  ReaExperimentCardController,
  type ReaExperimentField,
  type ReaExperimentSettings,
} from '../src/client/rea-experiment-card-controller.ts'

const defaults: ReaExperimentSettings = {
  enabled: false,
  command: 'npx',
  args: ['--yes', 'rea-agents@6.7.0', 'mcp'],
  toolCallTimeoutMs: 600_000,
}

function bench(enabled = false) {
  const host = stubSettingsScope<ReaExperimentSettings>()
  host.publish({ status: 'ready', writable: true, revision: 4, value: { ...defaults, enabled }, user: {} })
  const controller = new ReaExperimentCardController(host.scope)
  onTestFinished(() => { controller.dispose() })
  const face = controller.inject()
  const state = () => face.hooks.reaExperimentCard.getSnapshot()
  const accept = () => {
    host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
      const value = { ...host.scope.getSnapshot().value! }
      for (const op of ops) {
        if (op.op === 'set') Object.assign(value, { [op.path[0]!]: op.value })
      }
      host.publish({ value, revision: host.scope.getSnapshot().revision! + 1 })
    })
  }
  return { host, controller, face, state, accept }
}

describe('ReaExperimentCardController', () => {
  it('shows resolved defaults without enabling or launching REA', () => {
    const { host, face, state } = bench()
    expect(state()).toMatchObject({
      available: true, enabled: false, dirty: false, invalid: false,
      command: 'npx', args: JSON.stringify(defaults.args), toolCallTimeoutMs: '600000',
    })
    face.edit('command', 'another-program')
    face.save()
    expect(state().dirty).toBe(false)
    expect(host.mutate).not.toHaveBeenCalled()
  })

  it('saves enabled state and launch fields in one revision-fenced mutation', async () => {
    const { host, face, state, accept } = bench()
    accept()
    face.toggleEnabled()
    face.edit('command', ' C:\\Program Files\\REA\\rea.exe ')
    face.edit('args', '["mcp", "argument with spaces", "$(literal)"]')
    face.edit('toolCallTimeoutMs', '120000')
    expect(host.mutate).not.toHaveBeenCalled()
    face.save()
    await vi.waitFor(() => { expect(state().dirty).toBe(false) })
    expect(host.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['enabled'], value: true },
      { op: 'set', path: ['command'], value: 'C:\\Program Files\\REA\\rea.exe' },
      { op: 'set', path: ['args'], value: ['mcp', 'argument with spaces', '$(literal)'] },
      { op: 'set', path: ['toolCallTimeoutMs'], value: 120_000 },
    ], 4)
    expect(host.set).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ enabled: true, failed: false, saving: false })
  })

  it('discards invalid advanced drafts when disabling and preserves stored launch settings', async () => {
    const { host, face, state, accept } = bench(true)
    accept()
    face.edit('command', '')
    face.edit('args', 'broken JSON')
    face.edit('toolCallTimeoutMs', '-1')
    expect(state().invalid).toBe(true)
    face.toggleEnabled()
    expect(state()).toMatchObject({
      enabled: false, invalid: false, command: 'npx', args: JSON.stringify(defaults.args), toolCallTimeoutMs: '600000',
    })
    face.save()
    await vi.waitFor(() => { expect(state().dirty).toBe(false) })
    expect(host.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['enabled'], value: false },
    ], 4)
    expect(host.scope.getSnapshot().value).toEqual(defaults)
  })

  it.each<[ReaExperimentField, string]>([
    ['command', ' '], ['command', 'bad\0command'],
    ['args', '['], ['args', '{}'], ['args', '[1]'], ['args', '["bad\\u0000arg"]'],
    ['toolCallTimeoutMs', ''], ['toolCallTimeoutMs', '0'], ['toolCallTimeoutMs', '-1'],
    ['toolCallTimeoutMs', '1.5'], ['toolCallTimeoutMs', '2147483648'], ['toolCallTimeoutMs', 'NaN'],
  ])('blocks invalid %s drafts: %s', (field, text) => {
    const { host, face, state } = bench(true)
    face.edit(field, text)
    expect(state().invalid).toBe(true)
    face.save()
    expect(host.mutate).not.toHaveBeenCalled()
  })

  it('accepts empty argument arrays and the timer representation limit', async () => {
    const { host, face, state, accept } = bench(true)
    accept()
    face.edit('args', '[]')
    face.edit('toolCallTimeoutMs', '2147483647')
    face.save()
    await vi.waitFor(() => { expect(state().dirty).toBe(false) })
    expect(host.scope.getSnapshot().value).toMatchObject({ args: [], toolCallTimeoutMs: 2_147_483_647 })
  })

  it('keeps valid drafts after rejection and clears the error on the next edit', async () => {
    const { host, face, state } = bench()
    face.toggleEnabled()
    face.save()
    await vi.waitFor(() => { expect(state().failed).toBe(true) })
    expect(state()).toMatchObject({ enabled: true, dirty: true, saving: false, conflicted: false })
    face.edit('args', '["mcp"]')
    expect(state().failed).toBe(false)
    host.mutate.mockRejectedValueOnce(new Error('transport closed'))
    face.save()
    await vi.waitFor(() => { expect(state().failed).toBe(true) })
    face.discard()
    expect(state()).toMatchObject({ enabled: false, dirty: false, failed: false })
  })

  it('blocks stale drafts, then allows a fresh disable without replacing newer launch settings', async () => {
    const { host, face, state, accept } = bench(true)
    face.edit('args', '["staged"]')
    host.publish({ revision: 5, value: { ...defaults, enabled: true, command: 'new-rea' } })
    expect(state()).toMatchObject({ conflicted: true, invalid: true, dirty: true, failed: false })
    face.save()
    expect(host.mutate).not.toHaveBeenCalled()
    face.toggleEnabled()
    expect(state()).toMatchObject({ conflicted: false, enabled: false, command: 'new-rea' })
    accept()
    face.save()
    await vi.waitFor(() => { expect(state().dirty).toBe(false) })
    expect(host.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['enabled'], value: false }], 5)
    expect(host.scope.getSnapshot().value?.command).toBe('new-rea')
  })

  it('settles a draft already accepted at a newer Host revision', () => {
    const { host, face, state } = bench()
    face.toggleEnabled()
    host.publish({ revision: 5, value: { ...defaults, enabled: true } })
    expect(state()).toMatchObject({ dirty: false, conflicted: false, enabled: true })
  })

  it('reports a conflicting Host answer after an attempted save', async () => {
    const { host, face, state } = bench()
    host.mutate.mockImplementation(() => {
      host.publish({ revision: 5, value: { ...defaults, command: 'changed-elsewhere' } })
    })
    face.toggleEnabled()
    face.save()
    await vi.waitFor(() => { expect(state().saving).toBe(false) })
    expect(state()).toMatchObject({ dirty: true, failed: true, conflicted: true })
    face.discard()
    expect(state()).toMatchObject({ dirty: false, command: 'changed-elsewhere', conflicted: false })
  })

  it('suppresses duplicate saves and late settlements after a connection reset', async () => {
    const { host, face, state, controller } = bench()
    const pending = Promise.withResolvers<undefined>()
    host.mutate.mockReturnValueOnce(pending.promise)
    face.toggleEnabled()
    face.save()
    face.save()
    face.discard()
    face.edit('command', 'ignored')
    face.toggleEnabled()
    expect(host.mutate).toHaveBeenCalledTimes(1)
    expect(state()).toMatchObject({ saving: true, enabled: true, command: 'npx' })
    controller.resetConnection()
    expect(state()).toMatchObject({ saving: false, dirty: false, enabled: false })
    pending.reject(new Error('previous connection'))
    await Promise.resolve()
    expect(state()).toMatchObject({ saving: false, dirty: false, failed: false })
  })

  it('detaches its observer and ignores pending writes after disposal', async () => {
    const { host, face, state, controller } = bench()
    const pending = Promise.withResolvers<undefined>()
    host.mutate.mockReturnValueOnce(pending.promise)
    face.toggleEnabled()
    face.save()
    const before = state()
    controller.dispose()
    expect(host.listenerCount()).toBe(0)
    host.publish({ revision: 5, value: { ...defaults, enabled: true } })
    pending.resolve(undefined)
    await Promise.resolve()
    controller.resetConnection()
    face.toggleEnabled()
    face.discard()
    face.edit('command', 'ignored')
    face.save()
    expect(state()).toBe(before)
  })

  it('disables edits for read-only and unavailable scopes', () => {
    const { host, face, state } = bench()
    host.publish({ writable: false })
    face.toggleEnabled()
    face.edit('command', 'ignored')
    face.save()
    expect(state().dirty).toBe(false)
    host.publish({ status: 'unavailable', writable: true })
    face.toggleEnabled()
    face.save()
    expect(state().available).toBe(false)
    expect(host.mutate).not.toHaveBeenCalled()
  })
})
