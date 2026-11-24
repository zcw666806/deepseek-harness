/** Capability operation authority and connection replacement. */
import { describe, expect, it, vi } from 'vitest'
import type { CapabilityView } from '@deepseek-ai/dsh-capability-manager/types'
import { CapabilityController } from '../src/client/controller.ts'
import { capability, ID } from './fixtures.client.ts'

describe('capability settings controller', () => {
  it('rejects a malformed capability file before sending configuration to the Host', async () => {
    const remote = {
      list: vi.fn(async () => [capability]), perform: vi.fn(async () => capability),
      exportManifest: async () => ({ format: 'dsh-capabilities' as const, version: 1 as const, capabilities: [] }),
      planRestore: vi.fn(async () => ({ items: [] })), restoreManifest: vi.fn(async () => []),
    }
    const controller = new CapabilityController(remote)
    const face = controller.inject()
    face.restoreFile({ text: async () => JSON.stringify({ format: 'dsh-capabilities', version: 2, capabilities: [] }) } as File)
    await vi.waitFor(() => { expect(face.hooks.capabilities.getSnapshot().operation).toBeNull() })
    expect(face.hooks.capabilities.getSnapshot().error).toContain('Invalid dsh-capabilities')
    expect(remote.restoreManifest).not.toHaveBeenCalled()
    expect(remote.perform).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it('awaits a pending Remote before disposal and does not publish its late report', async () => {
    const pending = Promise.withResolvers<readonly CapabilityView[]>()
    const remote = {
      list: vi.fn((_signal: AbortSignal) => pending.promise), perform: vi.fn(async () => capability),
      exportManifest: async () => ({ format: 'dsh-capabilities' as const, version: 1 as const, capabilities: [] }),
      planRestore: vi.fn(async () => ({ items: [] })), restoreManifest: async () => [],
    }
    const controller = new CapabilityController(remote)
    const face = controller.inject()
    face.refresh()
    const finished = vi.fn()
    const disposing = controller.dispose().then(finished)
    expect(remote.list.mock.calls[0]?.[0].aborted).toBe(true)
    expect(finished).not.toHaveBeenCalled()
    pending.resolve([capability])
    await disposing
    expect(face.hooks.capabilities.getSnapshot().items).toBeNull()
    expect(finished).toHaveBeenCalledOnce()
  })

  it('previews a declarative file before explicit restoration without invoking runtime actions', async () => {
    const manifest = { format: 'dsh-capabilities' as const, version: 1 as const, capabilities: [{ id: ID, engineId: 'comfyui' }] }
    const remote = {
      list: vi.fn(async () => [capability]), perform: vi.fn(async () => capability), exportManifest: async () => manifest,
      planRestore: vi.fn(async () => ({ items: [] })), restoreManifest: vi.fn(async () => [{ id: ID, status: 'missing' as const, message: 'Provider unavailable' }]),
    }
    const controller = new CapabilityController(remote)
    const face = controller.inject()
    face.restoreFile({ text: async () => JSON.stringify(manifest) } as File)
    await vi.waitFor(() => { expect(face.hooks.capabilities.getSnapshot().operation).toBeNull() })
    expect(remote.planRestore).toHaveBeenCalledOnce()
    expect(remote.restoreManifest).not.toHaveBeenCalled()
    expect(remote.list).not.toHaveBeenCalled()
    face.applyRestoration()
    await vi.waitFor(() => { expect(face.hooks.capabilities.getSnapshot().operation).toBeNull() })
    expect(remote.restoreManifest).toHaveBeenCalledOnce()
    expect(remote.list).toHaveBeenCalledOnce()
    expect(remote.perform).not.toHaveBeenCalled()
    expect(face.hooks.capabilities.getSnapshot().restorations[0]?.status).toBe('missing')
    await controller.dispose()
  })

  it('publishes Host results only after a fixed action settles', async () => {
    const action = Promise.withResolvers<CapabilityView>()
    const remote = { exportManifest: async () => ({ format: 'dsh-capabilities' as const, version: 1 as const, capabilities: [] }), planRestore: vi.fn(async () => ({ items: [] })), restoreManifest: async () => [], list: vi.fn(async () => [capability]), perform: vi.fn(() => action.promise) }
    const controller = new CapabilityController(remote)
    const face = controller.inject()
    face.refresh()
    await vi.waitFor(() => { expect(face.hooks.capabilities.getSnapshot().operation).toBeNull() })
    expect(remote.perform).not.toHaveBeenCalled()
    face.perform(ID, 'prepare')
    expect(face.hooks.capabilities.getSnapshot().items?.[0]?.status).toBe('missing')
    expect(remote.perform.mock.calls[0]?.slice(0, 2)).toEqual([ID, 'prepare'])
    action.resolve({ ...capability, status: 'stopped', actions: ['check', 'start'], requirements: [] })
    await vi.waitFor(() => { expect(face.hooks.capabilities.getSnapshot().items?.[0]?.status).toBe('stopped') })
    await controller.dispose()
  })

  it('keeps cancellation pending until the Host request settles', async () => {
    const pending = Promise.withResolvers<readonly CapabilityView[]>()
    const remote = { exportManifest: async () => ({ format: 'dsh-capabilities' as const, version: 1 as const, capabilities: [] }), planRestore: vi.fn(async () => ({ items: [] })), restoreManifest: async () => [], list: vi.fn((_signal: AbortSignal) => pending.promise), perform: vi.fn(async () => capability) }
    const controller = new CapabilityController(remote)
    const face = controller.inject()
    face.refresh()
    face.cancel()
    expect(remote.list.mock.calls[0]?.[0].aborted).toBe(true)
    expect(face.hooks.capabilities.getSnapshot().cancelling).toBe(true)
    pending.reject(new Error('Request cancelled'))
    await vi.waitFor(() => { expect(face.hooks.capabilities.getSnapshot().operation).toBeNull() })
    expect(face.hooks.capabilities.getSnapshot()).toMatchObject({ requested: true, items: null, error: null })
    await controller.dispose()
  })

  it('ignores results from the replaced connection', async () => {
    const old = Promise.withResolvers<readonly CapabilityView[]>()
    const list = vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValueOnce([{ ...capability, status: 'ready' }])
    const controller = new CapabilityController({ exportManifest: async () => ({ format: 'dsh-capabilities', version: 1, capabilities: [] }), planRestore: vi.fn(async () => ({ items: [] })), restoreManifest: async () => [], list, perform: async () => capability })
    const face = controller.inject()
    face.refresh()
    controller.reset()
    face.refresh()
    await vi.waitFor(() => { expect(face.hooks.capabilities.getSnapshot().items?.[0]?.status).toBe('ready') })
    old.resolve([capability])
    await old.promise
    await Promise.resolve()
    expect(face.hooks.capabilities.getSnapshot().items?.[0]?.status).toBe('ready')
    await controller.dispose()
  })
})
