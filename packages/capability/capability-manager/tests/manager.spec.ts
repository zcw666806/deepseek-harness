import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CapabilityManager, { CapabilityId } from '../src/index.ts'
import type { CapabilityHealth, CapabilityProvider, Config, PortableCapabilityManifest } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
const signal = (): AbortSignal => new AbortController().signal

async function setup(config: Config = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const fiber = await ctx.plugin(CapabilityManager, config)
  return { ctx, fiber }
}

function provider(id = 'video.test'): CapabilityProvider {
  return {
    descriptor: { id: CapabilityId(id), title: 'Test engine', description: 'A configured engine', category: 'video',
      engineId: 'test-engine', version: '1.0', kind: 'local' },
    inspect: async () => ({ status: 'stopped', requirements: [{ id: 'model', title: 'Model', status: 'missing' }] }),
  }
}

function manifest(...capabilities: PortableCapabilityManifest['capabilities']): PortableCapabilityManifest {
  return { format: 'dsh-capabilities', version: 1, capabilities }
}

describe('installed capability management', () => {
  it('derives operations from installed callbacks and removes an effect-owned registration', async () => {
    const { ctx } = await setup()
    const item = provider()
    const dispose = ctx.capabilities.register({ ...item, start: async () => {} })
    expect(await ctx.capabilities.list(signal())).toEqual([{
      ...item.descriptor, status: 'stopped', requirements: [{ id: 'model', title: 'Model', status: 'missing' }], actions: ['check', 'start'],
    }])
    await expect(ctx.capabilities.perform(item.descriptor.id, 'prepare', signal())).rejects.toThrow('does not provide')
    await expect(ctx.capabilities.perform(CapabilityId('unknown'), 'start', signal())).rejects.toThrow('not registered')
    await dispose()
    expect(await ctx.capabilities.list(signal())).toEqual([])
  })

  it('serializes the same capability while letting another capability make progress', async () => {
    const { ctx } = await setup()
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const observed: string[] = []
    const one = provider('one')
    let state: CapabilityHealth['status'] = 'stopped'
    ctx.capabilities.register({ ...one, inspect: async () => ({ status: state, requirements: [] }),
      start: async () => { observed.push('start'); started.resolve(undefined); await release.promise; state = 'ready' },
      stop: async () => { observed.push('stop'); state = 'stopped' },
    })
    const two = provider('two')
    ctx.capabilities.register({ ...two, start: async () => { observed.push('other') } })
    const start = ctx.capabilities.perform(one.descriptor.id, 'start', signal())
    await started.promise
    const stop = ctx.capabilities.perform(one.descriptor.id, 'stop', signal())
    try {
      await ctx.capabilities.perform(two.descriptor.id, 'start', signal())
      expect(observed).toEqual(['start', 'other'])
    } finally { release.resolve(undefined) }
    expect((await start).status).toBe('ready')
    expect((await stop).status).toBe('stopped')
    expect(observed).toEqual(['start', 'other', 'stop'])
  })

  it('cancels and awaits removed provider work without removing a replacement with the same identity', async () => {
    const { ctx } = await setup()
    const started = Promise.withResolvers<undefined>()
    const aborted = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    const item = provider()
    const dispose = ctx.capabilities.register({ ...item, start: async (active) => {
      started.resolve(undefined)
      await new Promise<void>((resolve) => { active.addEventListener('abort', () => { aborted.resolve(undefined); resolve() }, { once: true }) })
      await finish.promise
      active.throwIfAborted()
    } })
    const operation = ctx.capabilities.perform(item.descriptor.id, 'start', signal())
    const checked = expect(operation).rejects.toThrow('provider was removed')
    await started.promise
    let settled = false
    const disposal = dispose().then(() => { settled = true })
    await aborted.promise
    ctx.capabilities.register({ ...item, descriptor: { ...item.descriptor, title: 'Replacement' } })
    expect(settled).toBe(false)
    finish.resolve(undefined)
    await disposal
    await checked
    expect((await ctx.capabilities.list(signal()))[0]?.title).toBe('Replacement')
  })

  it('does not execute a cancelled queued action and removes registrations on service unload', async () => {
    const { ctx, fiber } = await setup()
    const start = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    const stop = vi.fn(async () => {})
    const item = provider()
    ctx.capabilities.register({ ...item, start: async () => { start.resolve(undefined); await finish.promise }, stop })
    const pending = ctx.capabilities.perform(item.descriptor.id, 'start', signal())
    await start.promise
    const cancel = new AbortController()
    const queued = ctx.capabilities.perform(item.descriptor.id, 'stop', cancel.signal)
    const checked = expect(queued).rejects.toThrow('cancelled')
    cancel.abort(new Error('cancelled'))
    finish.resolve(undefined)
    await pending
    await checked
    expect(stop).not.toHaveBeenCalled()
    await fiber.dispose()
    expect(ctx.get('capabilities')).toBeUndefined()
  })

  it('returns safe error observations instead of provider exception details', async () => {
    const { ctx } = await setup()
    const item = provider()
    ctx.capabilities.register({ ...item, start: async () => { throw new Error('secret-token=private') } })
    const result = await ctx.capabilities.perform(item.descriptor.id, 'start', signal())
    expect(result).toMatchObject({ status: 'error', message: 'Capability start failed.' })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('bounds the complete encoded list and rejects registrations beyond the configured count', async () => {
    const { ctx } = await setup({ maxProviders: 2, maxResultBytes: 1024 })
    const first = provider('one')
    const second = provider('two')
    ctx.capabilities.register({ ...first, descriptor: { ...first.descriptor, description: '字'.repeat(150) } })
    expect(JSON.stringify(await ctx.capabilities.list(signal())).length).toBeLessThan(1024)
    ctx.capabilities.register({ ...second, descriptor: { ...second.descriptor, description: '字'.repeat(150) } })
    await expect(ctx.capabilities.list(signal())).rejects.toThrow('complete capability result')
    expect(() => ctx.capabilities.register(provider('third'))).toThrow('maxProviders')
  })

  it('notifies inspection and action deadlines without claiming completion before provider cleanup', async () => {
    const { ctx } = await setup({ checkTimeoutMs: 20, actionTimeoutMs: 30 })
    const settled: string[] = []
    const item = provider()
    ctx.capabilities.register({ ...item,
      inspect: async (active) => {
        await new Promise<void>((resolve) => { active.addEventListener('abort', () => { settled.push('inspect'); resolve() }, { once: true }) })
        active.throwIfAborted()
        return { status: 'ready', requirements: [] }
      },
      start: async (active) => {
        await new Promise<void>((resolve) => { active.addEventListener('abort', () => { settled.push('start'); resolve() }, { once: true }) })
        active.throwIfAborted()
      },
    })
    await expect(ctx.capabilities.perform(item.descriptor.id, 'check', signal())).rejects.toThrow('CAPABILITY_TIMEOUT')
    await expect(ctx.capabilities.perform(item.descriptor.id, 'start', signal())).rejects.toThrow('CAPABILITY_TIMEOUT')
    expect(settled).toEqual(['inspect', 'start'])
  })
})

describe('portable capability configuration', () => {
  it('exports only provider-declared settings and restores them without starting or preparing the engine', async () => {
    const first = await setup()
    const item = provider()
    const settings = { workflow: { nodes: ['prompt', 'video'] }, model: 'video-v1' }
    first.ctx.capabilities.register({ ...item, exportConfiguration: async () => settings })
    const exported = await first.ctx.capabilities.exportManifest(signal())
    expect(exported).toEqual(manifest({ id: item.descriptor.id, engineId: 'test-engine', version: '1.0', configuration: settings }))
    const target = await setup()
    const restore = vi.fn(async (_value: unknown) => {})
    const start = vi.fn(async () => {})
    const prepare = vi.fn(async () => {})
    target.ctx.capabilities.register({ ...item, restoreConfiguration: restore, start, prepare })
    expect(await target.ctx.capabilities.restoreManifest(exported, signal())).toEqual([{ id: item.descriptor.id, status: 'restored' }])
    expect(restore).toHaveBeenCalledWith(settings, expect.any(AbortSignal))
    expect(start).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  })

  it('reports missing engines, mismatched versions, unsupported restoration and rejected configuration independently', async () => {
    const { ctx } = await setup()
    ctx.capabilities.register(provider('wrong-version'))
    ctx.capabilities.register(provider('wrong-engine'))
    ctx.capabilities.register(provider('unsupported'))
    ctx.capabilities.register({ ...provider('rejected'), restoreConfiguration: async () => { throw new Error('secret') } })
    const result = await ctx.capabilities.restoreManifest(manifest(
      { id: CapabilityId('missing'), engineId: 'test-engine' },
      { id: CapabilityId('wrong-version'), engineId: 'test-engine', version: '2.0' },
      { id: CapabilityId('wrong-engine'), engineId: 'other' },
      { id: CapabilityId('unsupported'), engineId: 'test-engine', configuration: {} },
      { id: CapabilityId('rejected'), engineId: 'test-engine', configuration: {} },
    ), signal())
    expect(result.map(value => value.status)).toEqual(['missing', 'unsupported', 'unsupported', 'unsupported', 'failed'])
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('rejects malformed, oversized, and duplicate manifests before a configuration callback', async () => {
    const { ctx } = await setup({ maxResultBytes: 1024 })
    const restore = vi.fn(async () => {})
    const item = provider()
    ctx.capabilities.register({ ...item, restoreConfiguration: restore })
    const record = { id: item.descriptor.id, engineId: 'test-engine', configuration: {} }
    await expect(ctx.capabilities.restoreManifest(manifest(record, record), signal())).rejects.toThrow('repeats an identity')
    await expect(ctx.capabilities.restoreManifest({ ...manifest(record), arbitraryCommand: 'run' } as PortableCapabilityManifest, signal())).rejects.toThrow()
    await expect(ctx.capabilities.restoreManifest(manifest({ ...record, configuration: '字'.repeat(500) }), signal())).rejects.toThrow('maxResultBytes')
    expect(restore).not.toHaveBeenCalled()
  })
})
