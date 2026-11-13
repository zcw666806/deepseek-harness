import { afterEach, expect, it, vi } from 'vitest'
import { setup, projectInput, video, editable } from './helpers.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

it('persists Host-owned work, admits one batch, and pauses at a shot boundary', async () => {
  const fixture = await setup()
  cleanups.push(() => fixture.dispose())
  const { ctx, sessionId } = fixture
  const entered = barrier()
  const release = barrier()
  cleanups.push(async () =>{  release.resolve() })
  const generate = vi.fn(async () => { entered.resolve(); await release.promise; return { attachment: await video(ctx) } })
  ctx.videoProduction.registerGenerator('test', generate)
  const project = await ctx.videoProduction.update(sessionId, projectInput())
  const batch = await ctx.videoProduction.startBatch(sessionId, { revision: project.revision })
  await entered.promise
  await expect(ctx.videoProduction.startBatch(sessionId, { revision: project.revision })).rejects.toThrow('existing production batch')
  expect((await ctx.videoProduction.pauseBatch(sessionId, batch.id)).status).toBe('pausing')
  expect((await ctx.videoProduction.batch(sessionId))?.shots[0]?.status).toBe('running')
  release.resolve()
  await vi.waitFor(async () =>{  expect((await ctx.videoProduction.batch(sessionId))?.status).toBe('paused') })
  expect(generate).toHaveBeenCalledTimes(1)
  expect((await ctx.videoProduction.batch(sessionId))?.shots.map(shot => shot.status)).toEqual(['completed', 'pending'])
  await ctx.videoProduction.resumeBatch(sessionId, batch.id)
  await vi.waitFor(async () =>{  expect((await ctx.videoProduction.batch(sessionId))?.status).toBe('completed') })
  expect(generate).toHaveBeenCalledTimes(2)
})

it('retains uncertain submission across cold restart and resumes only unattempted shots', async () => {
  const first = await setup()
  cleanups.push(() => first.dispose())
  const entered = barrier()
  first.ctx.videoProduction.registerGenerator('test', async (_request, signal) => {
    entered.resolve()
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      if (signal.aborted) reject(new Error('aborted'))
    })
    throw new Error('unreachable')
  })
  const project = await first.ctx.videoProduction.update(first.sessionId, projectInput())
  const batch = await first.ctx.videoProduction.startBatch(first.sessionId, { revision: project.revision })
  await entered.promise
  await first.dispose(false)
  const second = await setup({}, first.root)
  cleanups.push(() => second.dispose(false))
  const generate = vi.fn(async () => ({ attachment: await video(second.ctx) }))
  second.ctx.videoProduction.registerGenerator('test', generate)
  expect((await second.ctx.videoProduction.batch(first.sessionId))?.shots.map(shot => shot.status)).toEqual(['uncertain', 'pending'])
  expect(generate).not.toHaveBeenCalled()
  await second.ctx.videoProduction.resumeBatch(first.sessionId, batch.id)
  await vi.waitFor(async () =>{  expect((await second.ctx.videoProduction.batch(first.sessionId))?.shots[1]?.status).toBe('completed') })
  expect(generate).toHaveBeenCalledTimes(1)
  expect((await second.ctx.videoProduction.batch(first.sessionId))?.shots[0]?.status).toBe('uncertain')
  await vi.waitFor(async () =>{  expect((await second.ctx.videoProduction.batch(first.sessionId))?.status).toBe('needs-review') })
  await second.ctx.videoProduction.resumeBatch(first.sessionId, batch.id)
  expect((await second.ctx.videoProduction.batch(first.sessionId))?.status).toBe('needs-review')
  expect(generate).toHaveBeenCalledTimes(1)
})

it('rejects changed input and provider revision before any pending submission', async () => {
  const fixture = await setup()
  cleanups.push(() => fixture.dispose())
  const { ctx, sessionId } = fixture
  const entered = barrier(), release = barrier()
  cleanups.push(async () =>{  release.resolve() })
  let revision = 'one'
  const generate = vi.fn(async () => { entered.resolve(); await release.promise; return { attachment: await video(ctx) } })
  ctx.videoProduction.registerGenerator('test', generate, () => [{ title: 'test', revision }])
  const project = await ctx.videoProduction.update(sessionId, projectInput())
  const batch = await ctx.videoProduction.startBatch(sessionId, { revision: project.revision })
  await entered.promise
  await ctx.videoProduction.cancelBatch(sessionId, batch.id)
  release.resolve()
  await vi.waitFor(async () =>{  expect((await ctx.videoProduction.batch(sessionId))?.status).toBe('cancelled') })
  revision = 'two'
  await expect(ctx.videoProduction.resumeBatch(sessionId, batch.id)).rejects.toThrow('configuration changed')
  revision = 'one'
  const current = await ctx.videoProduction.view(sessionId)
  const input = editable(current)
  await ctx.videoProduction.update(sessionId, { ...input, shots: input.shots.map(shot => ({ ...shot, prompt: 'changed' })) })
  await expect(ctx.videoProduction.resumeBatch(sessionId, batch.id)).rejects.toThrow('inputs or reference images changed')
  expect(generate).toHaveBeenCalledTimes(1)
})

it('recovers a persisted submission checkpoint without resubmitting it', async () => {
  const first = await setup()
  cleanups.push(() => first.dispose())
  const entered = barrier(), release = barrier()
  cleanups.push(async () =>{  release.resolve() })
  first.ctx.videoProduction.registerGenerator('test', async () => { entered.resolve(); await release.promise; return { attachment: await video(first.ctx) } })
  const project = await first.ctx.videoProduction.update(first.sessionId, projectInput())
  const batch = await first.ctx.videoProduction.startBatch(first.sessionId, { revision: project.revision })
  await entered.promise
  await first.ctx.videoProduction.pauseBatch(first.sessionId, batch.id)
  release.resolve()
  await vi.waitFor(async () =>{  expect((await first.ctx.videoProduction.batch(first.sessionId))?.status).toBe('paused') })
  const saved = (await first.ctx.videoProduction.batch(first.sessionId))!
  // A process can stop after the durable reservation and before the provider call or final checkpoint.
  await first.ctx.storageDomain.get('video_production_batches')!.table('batches').put(first.sessionId, {
    ...saved, status: 'running', shots: saved.shots.map((shot, index) => index === 1 ? { ...shot, status: 'running' } : shot),
  })
  await first.dispose(false)
  const second = await setup({}, first.root)
  cleanups.push(() => second.dispose(false))
  const generate = vi.fn(async () => ({ attachment: await video(second.ctx) }))
  second.ctx.videoProduction.registerGenerator('test', generate)
  const recovered = await second.ctx.videoProduction.batch(first.sessionId)
  expect(recovered?.status).toBe('needs-review')
  expect(recovered?.shots.map(shot => shot.status)).toEqual(['completed', 'uncertain'])
  await second.ctx.videoProduction.resumeBatch(first.sessionId, batch.id)
  expect(generate).not.toHaveBeenCalled()
  const current = await second.ctx.videoProduction.view(first.sessionId)
  await second.ctx.storageDomain.get('video_production')!.table('projects').put(first.sessionId, {
    sessionCreatedAt: recovered!.sessionCreatedAt,
    project: { ...current, shots: current.shots.map(shot => ({ ...shot, versions: [], selectedVersionId: undefined })) },
  })
  await expect(second.ctx.videoProduction.resumeBatch(first.sessionId, batch.id)).rejects.toThrow('completed batch result is absent')
  expect((await second.ctx.videoProduction.batch(first.sessionId))?.status).toBe('needs-review')
  expect(generate).not.toHaveBeenCalled()
})
