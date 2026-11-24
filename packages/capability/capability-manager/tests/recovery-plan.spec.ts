import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CapabilityManager, { CapabilityId } from '../src/index.ts'
import type { CapabilityProvider, PortableCapabilityManifest } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
const signal = (): AbortSignal => new AbortController().signal

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(CapabilityManager)
  return ctx
}

function manifest(capabilities: PortableCapabilityManifest['capabilities']): PortableCapabilityManifest {
  return { format: 'dsh-capabilities', version: 1, capabilities }
}

function provider(): CapabilityProvider {
  return { descriptor: { id: CapabilityId('engine.test'), title: 'Test engine', description: 'Target environment',
    category: 'video', engineId: 'test', version: '1', kind: 'local' },
  inspect: async () => ({ status: 'missing', requirements: [{ id: 'runtime', title: 'Runtime files', status: 'missing' }] }) }
}

describe('target-machine recovery preview', () => {
  it('reports current prerequisites without applying configuration or executing lifecycle actions', async () => {
    const ctx = await setup()
    const item = provider()
    const restoreConfiguration = vi.fn(async () => {})
    const prepare = vi.fn(async () => {})
    const start = vi.fn(async () => {})
    ctx.capabilities.register({ ...item, restoreConfiguration, prepare, start })
    const imported = manifest([{ id: item.descriptor.id, engineId: 'test', version: '1', configuration: { model: 'selected' } }])
    const result = await ctx.capabilities.planRestore(imported, signal())
    expect(result.items).toEqual([{
      id: item.descriptor.id, expectedEngineId: 'test', expectedVersion: '1', status: 'compatible', configuration: 'pending-validation',
      current: { ...item.descriptor, status: 'missing', requirements: [{ id: 'runtime', title: 'Runtime files', status: 'missing' }],
        actions: ['check', 'prepare', 'start'] },
    }])
    expect(restoreConfiguration).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('selected')
  })

  it('distinguishes missing engines, incompatible versions and providers without configuration restoration', async () => {
    const ctx = await setup()
    const item = provider()
    ctx.capabilities.register(item)
    const other = { ...item, descriptor: { ...item.descriptor, id: CapabilityId('engine.other') } }
    ctx.capabilities.register(other)
    const result = await ctx.capabilities.planRestore(manifest([
      { id: CapabilityId('absent'), engineId: 'absent' },
      { id: item.descriptor.id, engineId: 'test', version: '2' },
      { id: other.descriptor.id, engineId: 'test', configuration: { model: 'private-import' } },
    ]), signal())
    expect(result.items.map(value => [value.id, value.status, value.configuration])).toEqual([
      ['absent', 'missing', 'none'], ['engine.test', 'unsupported', 'none'], ['engine.other', 'unsupported', 'unsupported'],
    ])
    expect(JSON.stringify(result)).not.toContain('private-import')
  })

  it('rejects duplicate imported identities before inspecting any installed provider', async () => {
    const ctx = await setup()
    const item = provider()
    const inspect = vi.fn((active: AbortSignal) => item.inspect(active))
    ctx.capabilities.register({ ...item, inspect })
    const required = { id: item.descriptor.id, engineId: 'test' }
    await expect(ctx.capabilities.planRestore(manifest([required, required]), signal())).rejects.toThrow()
    expect(inspect).not.toHaveBeenCalled()
  })

  it('cancels a queued preview before its provider inspection runs', async () => {
    const ctx = await setup()
    const item = provider()
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const inspect = vi.fn((active: AbortSignal) => item.inspect(active))
    ctx.capabilities.register({ ...item, inspect, start: async () => { started.resolve(undefined); await release.promise } })
    const running = ctx.capabilities.perform(item.descriptor.id, 'start', signal())
    await started.promise
    const controller = new AbortController()
    const preview = ctx.capabilities.planRestore(manifest([{ id: item.descriptor.id, engineId: 'test' }]), controller.signal)
    const rejected = expect(preview).rejects.toThrow('cancelled preview')
    controller.abort(new Error('cancelled preview'))
    release.resolve(undefined)
    await running
    await rejected
    expect(inspect).toHaveBeenCalledTimes(1)
  })
})
