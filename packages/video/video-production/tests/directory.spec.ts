import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { persistSession, projectInput, setup, signal } from './helpers.ts'

const fixtures: Awaited<ReturnType<typeof setup>>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) await fixture.dispose()
})

async function fixture() {
  const value = await setup()
  fixtures.push(value)
  return value
}

describe('bounded saved-project presentation index', () => {
  it('lists only saved current projects without creating or materializing Sessions or changing project data', async () => {
    const { ctx, sessionId } = await fixture()
    const project = await ctx.videoProduction.update(sessionId, projectInput())
    const draft = ctx.sessions.create(SessionId('draft-without-project'))
    await persistSession(ctx, draft)
    const stat = vi.spyOn(ctx.sessionPersistence, 'stat')
    const create = vi.spyOn(ctx.sessions, 'create')
    const materialize = vi.spyOn(ctx.sessionPersistence, 'create')
    const active = signal()
    const summaries = await ctx.videoProduction.projectSummaries([draft.id, SessionId('unknown-session'), sessionId], active)
    expect(summaries).toEqual([{
      sessionId, projectId: project.id, revision: project.revision, displayTitle: project.title,
    }])
    expect(stat).toHaveBeenCalledTimes(1)
    expect(stat).toHaveBeenCalledWith(sessionId, { signal: active })
    expect(create).not.toHaveBeenCalled()
    expect(materialize).not.toHaveBeenCalled()
    expect(draft.seq).toBe(0)
    expect(await ctx.videoProduction.view(sessionId)).toEqual(project)
  })

  it('returns a Unicode code-point excerpt while preserving the complete stored title', async () => {
    const { ctx, sessionId } = await fixture()
    const title = '🦊'.repeat(159) + '汉' + '🐾'.repeat(5000)
    const project = await ctx.videoProduction.update(sessionId, { ...projectInput(), title })
    const summaries = await ctx.videoProduction.projectSummaries([sessionId], signal())
    expect(summaries[0]?.displayTitle).toBe('🦊'.repeat(159) + '汉')
    expect(Array.from(summaries[0]?.displayTitle ?? '')).toHaveLength(160)
    expect(summaries[0]?.displayTitle.endsWith('\ud83e')).toBe(false)
    expect(await ctx.videoProduction.view(sessionId)).toEqual(project)
  })

  it('omits a stored project when its Session identity belongs to a different lifecycle', async () => {
    const { ctx, sessionId } = await fixture()
    const project = await ctx.videoProduction.update(sessionId, projectInput())
    const original = ctx.sessionPersistence.stat.bind(ctx.sessionPersistence)
    const stat = vi.spyOn(ctx.sessionPersistence, 'stat').mockImplementation(async (id, active) => {
      const result = await original(id, active)
      if (result === undefined) throw new Error('Expected a stored Session')
      return { ...result, header: { ...result.header, createdAt: result.header.createdAt + 1 } }
    })
    expect(await ctx.videoProduction.projectSummaries([sessionId], signal())).toEqual([])
    stat.mockRestore()
    expect(await ctx.videoProduction.view(sessionId)).toEqual(project)
  })

  it('omits a Session deleted during inspection while preserving unrelated storage errors', async () => {
    const { ctx, sessionId } = await fixture()
    const project = await ctx.videoProduction.update(sessionId, projectInput())
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const stat = vi.spyOn(ctx.sessionPersistence, 'stat').mockImplementationOnce(async () => {
      entered.resolve(undefined)
      await release.promise
      return undefined
    })
    const pending = ctx.videoProduction.projectSummaries([sessionId], signal())
    try {
      await entered.promise
      release.resolve(undefined)
      expect(await pending).toEqual([])
    } finally { release.resolve(undefined); await Promise.allSettled([pending]) }
    const failure = Object.assign(new Error('Persistence read denied'), { code: 'EACCES' })
    stat.mockRejectedValueOnce(failure)
    await expect(ctx.videoProduction.projectSummaries([sessionId], signal())).rejects.toBe(failure)
    stat.mockRestore()
    expect(await ctx.videoProduction.view(sessionId)).toEqual(project)
  })

  it('rejects duplicate, oversized and invalid requests before inspecting persistence', async () => {
    const { ctx, sessionId } = await fixture()
    await ctx.videoProduction.update(sessionId, projectInput())
    const stat = vi.spyOn(ctx.sessionPersistence, 'stat')
    await expect(ctx.videoProduction.projectSummaries([sessionId, sessionId], signal())).rejects.toThrow('distinct')
    await expect(ctx.videoProduction.projectSummaries(Array.from({ length: 257 }, (_, index) => SessionId(`requested-${index}`)), signal())).rejects.toThrow()
    await expect(ctx.videoProduction.projectSummaries([SessionId('x'.repeat(257))], signal())).rejects.toThrow()
    expect(stat).not.toHaveBeenCalled()
    expect(await ctx.videoProduction.projectSummaries([], signal())).toEqual([])
  })

  it('honors cancellation before and between lifecycle reads', async () => {
    const { ctx, sessionId } = await fixture()
    await ctx.videoProduction.update(sessionId, projectInput())
    const other = ctx.sessions.create(SessionId('another-saved-project'))
    await persistSession(ctx, other)
    await ctx.videoProduction.update(other.id, projectInput())
    const controller = new AbortController()
    const original = ctx.sessionPersistence.stat.bind(ctx.sessionPersistence)
    const stat = vi.spyOn(ctx.sessionPersistence, 'stat').mockImplementationOnce(async (id, active) => {
      const result = await original(id, active)
      controller.abort(new Error('Summary query cancelled'))
      return result
    })
    await expect(ctx.videoProduction.projectSummaries([sessionId, other.id], controller.signal)).rejects.toThrow('Summary query cancelled')
    expect(stat).toHaveBeenCalledTimes(1)
    await expect(ctx.videoProduction.projectSummaries([], controller.signal)).rejects.toThrow('Summary query cancelled')
  })
})
