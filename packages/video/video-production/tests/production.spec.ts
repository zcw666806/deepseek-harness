import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { SessionId } from '@deepseek-ai/dsh-session'
import { VideoAssetId, VideoProjectId, VideoShotId } from '../src/index.ts'
import type { VideoGenerationInput, VideoGenerationResult, VideoProject } from '../src/types.ts'
import { editable, imageData, projectInput, sceneImageData, setup, shot, signal, video } from './helpers.ts'

const fixtures: Awaited<ReturnType<typeof setup>>[] = []
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.dispose() })
async function fixture(config: Parameters<typeof setup>[0] = {}) {
  const value = await setup(config)
  fixtures.push(value)
  return value
}

describe('Session-owned video production', () => {
  it('requires an unambiguous current target, enforces its limits, and freezes its provenance', async () => {
    const { ctx, sessionId } = await fixture()
    await ctx.videoProduction.update(sessionId, projectInput())
    const generate = vi.fn(async (_input: VideoGenerationInput) => ({ attachment: await video(ctx) }))
    let revision = 'workflow-v1'
    const unregister = ctx.videoProduction.registerGenerator('local', generate, () => [{
      title: 'Local workflow', model: 'local-video', revision,
      limits: { durations: [2], aspectRatios: ['16:9'], resolutions: ['480p'], maxReferenceImages: 0 },
    }])
    ctx.videoProduction.registerGenerator('remote', generate)
    expect(ctx.videoProduction.generationTargets()).toHaveLength(2)
    await expect(ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())).rejects.toThrow('Choose one')
    await expect(ctx.videoProduction.generate(sessionId, VideoShotId('first'), { generator: 'local', model: 'unknown' }, signal())).rejects.toThrow('No matching')
    const project = await ctx.videoProduction.generate(sessionId, VideoShotId('first'), { generator: 'local', model: 'local-video' }, signal())
    expect(generate.mock.calls[0]?.[0].model).toBe('local-video')
    expect(project.shots[0]?.versions[0]).toMatchObject({ generator: 'local', generatorTitle: 'Local workflow', generatorRevision: 'workflow-v1', model: 'local-video' })
    revision = 'workflow-v2'
    const changed = await ctx.videoProduction.update(sessionId, { ...editable(project), shots: [shot('first', { duration: 3 })] })
    await expect(ctx.videoProduction.generate(sessionId, VideoShotId('first'), { generator: 'local' }, signal())).rejects.toThrow('exceed')
    expect((await ctx.videoProduction.view(sessionId)).revision).toBe(changed.revision)
    expect(changed.shots[0]?.versions[0]?.generatorRevision).toBe('workflow-v1')
    expect(generate).toHaveBeenCalledOnce()
    unregister()
    await expect(ctx.videoProduction.generate(sessionId, VideoShotId('first'), { generator: 'local' }, signal())).rejects.toThrow('No matching')
  })

  it('admits concurrent missing-shot requests once after the first queued attempt succeeds', async () => {
    const { ctx, sessionId } = await fixture()
    await ctx.videoProduction.update(sessionId, projectInput())
    const attachment = await video(ctx)
    const started = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<VideoGenerationResult>()
    const generate = vi.fn((_request: VideoGenerationInput, active: AbortSignal) => {
      active.addEventListener('abort', () => { finish.reject(new Error('cancelled')) }, { once: true })
      started.resolve(undefined)
      return finish.promise
    })
    ctx.videoProduction.registerGenerator('test', generate)
    const first = ctx.videoProduction.generate(sessionId, VideoShotId('first'), { onlyIfMissing: true }, signal())
    await started.promise
    const queued = ctx.videoProduction.generate(sessionId, VideoShotId('first'), { onlyIfMissing: true }, signal())
    expect((await ctx.videoProduction.view(sessionId)).shots[0]?.versions[0]?.status).toBe('running')
    finish.resolve({ attachment })
    const [completed, reused] = await Promise.all([first, queued])
    expect(generate).toHaveBeenCalledOnce()
    expect(reused).toEqual(completed)
    expect(reused.shots[0]?.versions).toHaveLength(1)
  })

  it('allows a queued missing-shot request to retry after the preceding attempt fails', async () => {
    const { ctx, sessionId } = await fixture()
    await ctx.videoProduction.update(sessionId, projectInput())
    const attachment = await video(ctx)
    const started = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<VideoGenerationResult>()
    let firstCall = true
    const generate = vi.fn((_request: VideoGenerationInput, active: AbortSignal) => {
      if (!firstCall) return Promise.resolve({ attachment })
      firstCall = false
      active.addEventListener('abort', () => { finish.reject(new Error('cancelled')) }, { once: true })
      started.resolve(undefined)
      return finish.promise
    })
    ctx.videoProduction.registerGenerator('test', generate)
    const first = ctx.videoProduction.generate(sessionId, VideoShotId('first'), { onlyIfMissing: true }, signal())
    await started.promise
    const queued = ctx.videoProduction.generate(sessionId, VideoShotId('first'), { onlyIfMissing: true }, signal())
    finish.reject(new Error('Provider failed'))
    const [failed, completed] = await Promise.all([first, queued])
    expect(failed.shots[0]?.versions[0]?.status).toBe('failed')
    expect(completed.shots[0]?.versions.map(item => item.status)).toEqual(['failed', 'completed'])
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('preserves versions through edits and reordering and rejects stale or invalid replacements', async () => {
    const { ctx, sessionId } = await fixture()
    expect(await ctx.videoProduction.view(sessionId)).toMatchObject({ revision: 0, shots: [] })
    let project = await ctx.videoProduction.update(sessionId, projectInput())
    const dispose = ctx.videoProduction.registerGenerator('test', async () => ({ attachment: await video(ctx) }))
    project = await ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    expect(project.shots[0]?.versions[0]?.status).toBe('completed')
    const version = project.shots[0]?.selectedVersionId
    project = await ctx.videoProduction.update(sessionId, {
      ...editable(project), shots: project.shots.map(item => shot(item.id, { prompt: 'An edited prompt', selectedVersionId: item.selectedVersionId })),
    })
    expect(project.shots[0]?.versions[0]).toMatchObject({
      id: version, prompt: 'A view of first', duration: 2, aspectRatio: '16:9', resolution: '480p', referenceImages: [],
    })
    project = await ctx.videoProduction.reorder(sessionId, [VideoShotId('second'), VideoShotId('first')])
    expect(project.shots.map(item => item.id)).toEqual(['second', 'first'])
    await expect(ctx.videoProduction.update(sessionId, projectInput())).rejects.toThrow('reload')
    await expect(ctx.videoProduction.reorder(sessionId, [VideoShotId('first'), VideoShotId('first')])).rejects.toThrow('exactly once')
    await expect(ctx.videoProduction.update(sessionId, { ...editable(project), shots: [shot('bad', { assetIds: [VideoAssetId('absent')] })] })).rejects.toThrow('absent')
    await expect(ctx.videoProduction.update(sessionId, { ...editable(project), shots: [shot('bad', { duration: 16 })] })).rejects.toThrow()
    dispose()
    await expect(ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())).rejects.toThrow('No matching')
  })

  it('admits owned reference images, preserves each shot reference order, and denies foreign media', async () => {
    const { ctx, sessionId } = await fixture()
    let project = await ctx.videoProduction.update(sessionId, projectInput())
    project = await ctx.videoProduction.addAsset(sessionId, {
      revision: project.revision, name: 'Character', kind: 'character', description: 'The protagonist',
      image: { mediaType: 'image/png', data: imageData },
    }, signal())
    const owned = project.assets[0]!
    project = await ctx.videoProduction.addAsset(sessionId, {
      revision: project.revision, name: 'Scene', kind: 'scene', description: 'The location',
      image: { mediaType: 'image/png', data: sceneImageData },
    }, signal())
    const second = project.assets[1]!
    expect(second.image?.attachmentId).not.toBe(owned.image?.attachmentId)
    project = await ctx.videoProduction.update(sessionId, {
      ...editable(project), assets: [owned, second],
      shots: [shot('first', { assetIds: [second.id, owned.id] })],
    })
    const generate = vi.fn(async (_request: VideoGenerationInput) => ({ attachment: await video(ctx) }))
    ctx.videoProduction.registerGenerator('test', generate)
    project = await ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ referenceImages: [second.image, owned.image] })
    const ref = project.shots[0]!.versions[0]!.attachment!
    project = await ctx.videoProduction.update(sessionId, {
      ...editable(project), assets: [], shots: [shot('first', { duration: 4, resolution: '720p' })],
    })
    expect(project.shots[0]?.versions[0]).toMatchObject({ duration: 2, resolution: '480p', referenceImages: [second.image, owned.image] })
    const historical = await ctx.videoProduction.readMedia(sessionId, project.id, owned.image!.attachmentId, 0, 262144)
    expect(historical.attachment.attachmentId).toBe(owned.image?.attachmentId)
    const one = await ctx.videoProduction.readMedia(sessionId, project.id, ref.attachmentId, 0, 5)
    const rest = await ctx.videoProduction.readMedia(sessionId, project.id, ref.attachmentId, one.nextOffset, 256 * 1024)
    expect(Buffer.concat([Buffer.from(one.data, 'base64'), Buffer.from(rest.data, 'base64')])).toEqual(Buffer.from((await ctx.attachments.readVideo(ref)).data))
    expect(rest.nextOffset).toBe(rest.totalBytes)
    await expect(ctx.videoProduction.readMedia(sessionId, project.id, ref.attachmentId, 0, 256 * 1024 + 1)).rejects.toThrow('262144')
    await expect(ctx.videoProduction.readMedia(sessionId, VideoProjectId('foreign'), ref.attachmentId, 0, 10)).rejects.toThrow('does not exist')
    await expect(ctx.videoProduction.readMedia(sessionId, project.id, AttachmentId('foreign'), 0, 10)).rejects.toThrow('not referenced')
    const other = ctx.sessions.create(SessionId('other-session'))
    await ctx.sessionPersistence.ensureMaterialized(other)
    const foreign = await ctx.videoProduction.update(other.id, projectInput())
    await expect(ctx.videoProduction.update(other.id, { ...editable(foreign), assets: [owned] })).rejects.toThrow('does not belong')
  })

  it('does not pay for selected assets without images and retains failed attempts for retry', async () => {
    const { ctx, sessionId } = await fixture()
    const asset = { id: VideoAssetId('unfilled'), name: 'Character', kind: 'character' as const, description: 'Waiting for a reference' }
    await ctx.videoProduction.update(sessionId, { ...projectInput(), assets: [asset], shots: [shot('first', { assetIds: [asset.id] })] })
    const generate = vi.fn(async () => ({ attachment: await video(ctx) }))
    ctx.videoProduction.registerGenerator('test', generate)
    let project = await ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    expect(project.shots[0]?.versions[0]?.status).toBe('failed')
    expect(project.shots[0]?.versions[0]?.error).toContain('admitted image')
    expect(generate).not.toHaveBeenCalled()
    project = await ctx.videoProduction.update(sessionId, { ...editable(project), assets: [], shots: [shot('first')] })
    project = await ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    expect(project.shots[0]?.versions.map(item => item.status)).toEqual(['failed', 'completed'])
  })

  it('records cancellation only after provider work settles and unloads to quiescence', async () => {
    const { ctx, sessionId, fiber } = await fixture()
    await ctx.videoProduction.update(sessionId, projectInput())
    const started = Promise.withResolvers<undefined>()
    let settled = false
    ctx.videoProduction.registerGenerator('test', async (_request, active) => {
      started.resolve(undefined)
      await new Promise<void>((_resolve, reject) => {
        active.addEventListener('abort', () => {
          settled = true
          const reason: unknown = active.reason
          reject(reason instanceof Error ? reason : new Error('Generation cancelled'))
        }, { once: true })
      })
      throw new Error('unreachable')
    })
    const pending = ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    await started.promise
    expect((await ctx.videoProduction.view(sessionId)).shots[0]?.versions[0]?.status).toBe('running')
    await fiber.dispose()
    expect(settled).toBe(true)
    expect((await pending).shots[0]?.versions[0]?.status).toBe('interrupted')
    expect(ctx.tools.get('video_project')).toBeUndefined()
    expect(ctx.get('videoProduction')).toBeUndefined()
  })

  it('retains terminal failure when local export capability is unavailable', async () => {
    const { ctx, sessionId } = await fixture()
    await ctx.videoProduction.update(sessionId, { ...projectInput(), shots: [shot('first')] })
    ctx.videoProduction.registerGenerator('test', async () => ({ attachment: await video(ctx) }))
    await ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    const project = await ctx.videoProduction.export(sessionId, signal())
    expect(project.exports[0]?.status).toBe('failed')
    expect(project.exports[0]?.error).toContain('VIDEO_EXPORT_UNAVAILABLE')
  })

  it('retains a bounded failed result instead of leaving an oversized provider error running', async () => {
    const { ctx, sessionId } = await fixture({ maxProjectBytes: 1500 })
    await ctx.videoProduction.update(sessionId, projectInput())
    ctx.videoProduction.registerGenerator('test', async () => { throw new Error('x'.repeat(10000)) })
    const project = await ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    expect(project.shots[0]?.versions[0]).toMatchObject({ status: 'failed', error: 'The generated result exceeds maxProjectBytes.' })
    expect(Buffer.byteLength(JSON.stringify(project))).toBeLessThanOrEqual(1500)
  })

  it('reopens the exact durable project and marks a crash-left running attempt as interrupted', async () => {
    const first = await fixture()
    const initial = await first.ctx.videoProduction.update(first.sessionId, projectInput())
    await first.dispose(false)
    fixtures.splice(fixtures.indexOf(first), 1)
    const file = join(first.root, 'storage', 'video_production.json')
    const document = JSON.parse(await readFile(file, 'utf8')) as { tables: { projects: Record<string, { project: VideoProject }> } }
    const stored = document.tables.projects[first.sessionId]!.project
    Object.assign(stored, { shots: [{ ...stored.shots[0], versions: [{
      id: 'crash-attempt', prompt: 'A view', status: 'running', duration: 2,
      aspectRatio: '16:9', resolution: '480p', referenceImages: [],
    }] }] })
    await writeFile(file, JSON.stringify(document))
    const second = await setup({}, first.root)
    fixtures.push(second)
    const project = await second.ctx.videoProduction.view(first.sessionId)
    expect(project.id).toBe(initial.id)
    expect(project.shots[0]?.versions[0]).toMatchObject({ status: 'interrupted' })
  })
})
