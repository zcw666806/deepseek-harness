/** Real generated Remote descriptors, Gateway mounting, and disposable workspace registration. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { apply as gatewayApply, inject as gatewayInject } from '@deepseek-ai/dsh-api-gateway/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import videoProductionRemote from '@deepseek-ai/dsh-video-production/remote'
import capabilitiesRemote from '@deepseek-ai/dsh-capability-manager/remote'
import sessionRemote from '@deepseek-ai/dsh-api-session-controller/remote'
import type { UiWorkspace, SessionReuseGuard } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { VideoBatch, VideoBatchId } from '@deepseek-ai/dsh-video-production/types'
import type { ProductionFace } from '../src/client/controller.ts'
import type { GeneratedVideoFace } from '../src/client/GeneratedVideoCard.tsx'
import { mountVideoProductionUi } from '../src/client/mount.ts'
import { project, SESSION, SHOT_A, VIDEO } from './fixtures.ts'


function replyValue(endpoint: string, current = project()) {
  if (endpoint === 'videoProduction/batch') return null
  if (endpoint === 'videoProduction/generationTargets') return [{ generator: 'fixture', title: 'Fixture' }]
  if (endpoint === 'videoProduction/projectSummaries') return current.revision === 0 ? [] : [{
    sessionId: current.sessionId, projectId: current.id, revision: current.revision, displayTitle: current.title,
  }]
  return current
}

async function bench(workspace?: UiWorkspace) {
  const ctx = new Context()
  if (workspace !== undefined) ctx.provide('uiWorkspace', workspace)
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SlotRegistry)
  const call = vi.fn<ConnectionHandle['rpc']['call']>(async (_channel, endpoint) => ({
    ok: true, value: replyValue(endpoint),
  }))
  ctx.provide('connection', {
    rpc: {
      call,
      open: async function* () { throw new Error('This unary workspace fixture does not open streams.') },
    },
    registerGenerationSource: () => () => {},
    start: () => ({ stop() {} }),
  } as unknown as ConnectionHandle)
  await ctx.plugin({ inject: [...gatewayInject], apply: gatewayApply })
  const disposeCapabilities = await ctx.remote.$mount(capabilitiesRemote)
  ctx.effect(() => disposeCapabilities, 'video workspace fixture: capabilities Remote')
  const disposeSession = await ctx.remote.$mount(sessionRemote)
  ctx.effect(() => disposeSession, 'video workspace fixture: Session Remote')
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const scope = ctx.plugin({ apply() {} })
  await scope
  ctx.provide('sessions', {
    scope: (id: SessionId) => id === SESSION ? scope.ctx : undefined,
    list: createSnapshotStore({ ids: [SESSION], byId: {}, current: SESSION, phase: 'ready' }),
  })
  ctx.slots.register({
    name: 'root', children: {
      'conversation.view': { kind: 'list', scope: 'session' },
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
    },
  } as never, () => null)
  const dispose = await mountVideoProductionUi(ctx, videoProductionRemote, 1000)
  const entry = ctx.slots.entries('conversation.view').find(value => value.options.id === 'video-production')
  if (entry === undefined) throw new Error('Video production workspace was not registered.')
  const face = (entry.inject as unknown as (sessionId: SessionId) => ProductionFace)(SESSION)
  face.refresh()
  await vi.waitFor(() => {
    const snapshot = face.hooks.production.getSnapshot()
    if (snapshot.error !== null) throw new Error(snapshot.error)
    expect(snapshot.project?.id).toBe(project().id)
  })
  return { ctx, scope, call, face, dispose }
}

async function settled(face: ProductionFace): Promise<void> {
  await vi.waitFor(() => { expect(face.hooks.production.getSnapshot().operation).toBeNull() })
}

describe('video production browser mount', () => {
  it('forwards durable batch admission and controls through generated unary methods', async () => {
    const b = await bench()
    const batch: VideoBatch = {
      id: 'batch-fixture' as VideoBatchId, sessionId: SESSION, sessionCreatedAt: 1,
      projectId: project().id, inputRevision: 1, generator: 'fixture', status: 'running', shots: [],
    }
    b.call.mockImplementation(async (_channel, endpoint) => ({ ok: true, value:
      endpoint === 'videoProduction/startBatch' || endpoint.endsWith('Batch') ? batch : replyValue(endpoint),
    }))
    b.face.generateMissing({ generator: 'fixture' })
    await settled(b.face)
    expect(b.face.hooks.production.getSnapshot().batch?.id).toBe(batch.id)
    b.face.pauseBatch()
    await settled(b.face)
    b.face.resumeBatch()
    await settled(b.face)
    b.face.cancelBatch()
    await settled(b.face)
    const calls = b.call.mock.calls.filter(call => call[1].endsWith('Batch'))
    expect(calls.map(call => call[1])).toEqual([
      'videoProduction/startBatch', 'videoProduction/pauseBatch', 'videoProduction/resumeBatch', 'videoProduction/cancelBatch',
    ])
    expect(calls[0]?.[2]).toEqual({ args: { sessionId: SESSION, input: { revision: 1, generator: 'fixture' } } })
    for (const call of calls.slice(1)) expect(call[2]).toEqual({ args: { sessionId: SESSION, id: batch.id } })
  })

  it('guards saved and busy projects, probes empty candidates, and withdraws its guard on unload', async () => {
    const guards = new Set<SessionReuseGuard>()
    const unexpected = (): never => { throw new Error('Only reuse registration belongs to this fixture.') }
    const workspace: UiWorkspace = {
      registerSessionPresentation: () => () => {},
      registerSessionReuseGuard: (guard) => { guards.add(guard); return async () => { guards.delete(guard) } },
      connectWorkspace: unexpected, startSession: unexpected, archiveSession: unexpected,
      pickDirectory: unexpected, listDirectory: unexpected, createDirectory: unexpected,
    }
    const b = await bench(workspace)
    await vi.waitFor(() => { expect(guards.size).toBe(1) })
    const guard = [...guards][0]!
    b.call.mockClear()
    await expect(guard(SESSION)).resolves.toBe(false)
    expect(b.call).not.toHaveBeenCalled()
    const empty = { ...project(), revision: 0, shots: [], assets: [], exports: [] }
    let authoritative = empty
    b.call.mockImplementation(async (_channel, endpoint) => ({ ok: true, value: replyValue(endpoint, authoritative) }))
    b.face.refresh()
    await settled(b.face)
    await expect(guard(SESSION)).resolves.toBe(true)
    expect(b.call.mock.lastCall?.[1]).toBe('videoProduction/view')
    authoritative = { ...project(), shots: [], assets: [], exports: [] }
    await expect(guard(SESSION)).resolves.toBe(false)
    const pending = Promise.withResolvers<Awaited<ReturnType<ConnectionHandle['rpc']['call']>>>()
    b.call.mockImplementation(async (_channel, endpoint) => endpoint === 'videoProduction/view'
      ? await pending.promise : { ok: true, value: replyValue(endpoint, empty) })
    b.face.refresh()
    const calls = b.call.mock.calls.length
    await expect(guard(SESSION)).resolves.toBe(false)
    expect(b.call).toHaveBeenCalledTimes(calls)
    pending.resolve({ ok: true, value: empty })
    await settled(b.face)
    await b.dispose()
    expect(guards.size).toBe(0)
  })

  it('mounts generated descriptors and forwards raw cancellation signals through the real Gateway', async () => {
    const b = await bench()
    expect(b.ctx.get('remote.videoProduction')).toBeDefined()
    expect(b.ctx.slots.entries('tool.call.toolview').map(entry => entry.options.key)).toEqual(['generate_video'])
    const names = videoProductionRemote.descriptors.map(descriptor => descriptor.method)
    expect(names).toContain('generate')
    expect(names).toContain('export')
    expect(names).toContain('addAsset')

    b.face.generate(SHOT_A)
    await settled(b.face)
    b.face.exportFilm()
    await settled(b.face)
    const file = {
      type: 'image/png', name: 'reference.png', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as File
    b.face.addAsset(file, 'Traveler', 'character')
    await settled(b.face)

    const calls = b.call.mock.calls.filter(value => ![
      'videoProduction/view', 'videoProduction/generationTargets', 'videoProduction/projectSummaries', 'videoProduction/batch',
    ].includes(value[1]))
    expect(calls.map(value => value[1])).toEqual([
      'videoProduction/generate', 'videoProduction/export', 'videoProduction/addAsset',
    ])
    for (const call of calls) {
      expect(call[3]).toBeInstanceOf(AbortSignal)
      expect(call[3]?.aborted).toBe(false)
      expect(call[2]).toMatchObject({ args: { sessionId: SESSION } })
      expect((call[2] as { args: object }).args).not.toHaveProperty('signal')
    }
    expect(calls[0]?.[2]).toEqual({ args: { sessionId: SESSION, shotId: SHOT_A, selection: {} } })
    expect(calls[2]?.[2]).toMatchObject({
      args: { input: { revision: 1, name: 'Traveler', kind: 'character', image: { mediaType: 'image/png', data: 'AQID' } } },
    })
    expect(b.face.hooks.production.getSnapshot().error).toBeNull()

    const card = b.ctx.slots.entries('tool.call.toolview').find(entry => entry.options.key === 'generate_video')
    if (card === undefined) throw new Error('Generated video card was not registered.')
    const preview = (card.inject as unknown as (sessionId: SessionId) => GeneratedVideoFace)(SESSION)
    b.call.mockResolvedValueOnce({
      ok: true, value: { attachment: VIDEO, data: btoa('test'), offset: 0, nextOffset: 4, total: 4 },
    })
    expect((await preview.readVideo(VIDEO.attachmentId, 0, 4)).total).toBe(4)
    expect(b.call.mock.lastCall?.[1]).toBe('session/videoAttachment')
    expect(b.call.mock.lastCall?.[2]).toEqual({
      args: { request: { sessionId: SESSION, attachmentId: VIDEO.attachmentId, offset: 0, length: 4 } },
    })

    await b.dispose()
    expect(b.ctx.get('remote.videoProduction')).toBeUndefined()
    expect(b.ctx.slots.entries('conversation.view')).toEqual([])
    expect(b.ctx.slots.entries('tool.call.toolview')).toEqual([])
  })

  it('cancels a pending request when its Session scope ends and ignores late completion', async () => {
    const b = await bench()
    let pendingSignal: AbortSignal | undefined
    const response = Promise.withResolvers<Awaited<ReturnType<ConnectionHandle['rpc']['call']>>>()
    b.call.mockImplementation((_channel, _endpoint, _payload, signal) => {
      pendingSignal = signal
      return response.promise
    })
    b.face.generate(SHOT_A)
    const pending = b.face.hooks.production.getSnapshot()
    expect(pending.operation?.kind).toBe('generate')
    const disposing = b.scope.dispose()
    await vi.waitFor(() => { expect(pendingSignal?.aborted).toBe(true) })
    expect(pendingSignal?.aborted).toBe(true)
    response.resolve({ ok: true, value: { ...project(), revision: 99 } })
    await response.promise
    await disposing
    await Promise.resolve()
    await Promise.resolve()
    expect(b.face.hooks.production.getSnapshot()).toBe(pending)
    await b.dispose()
  })

  it('withdraws the generated namespace when workspace registration fails', async () => {
    const b = await bench()
    await b.dispose()
    vi.spyOn(b.ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('workspace slot unavailable') })
    await expect(mountVideoProductionUi(b.ctx, videoProductionRemote, 1000)).rejects.toThrow('workspace slot unavailable')
    expect(b.ctx.get('remote.videoProduction')).toBeUndefined()
    expect(b.ctx.slots.entries('conversation.view')).toEqual([])
  })
})
