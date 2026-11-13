import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { CapabilityId } from '@deepseek-ai/dsh-capability-manager'
import CapabilityManager from '@deepseek-ai/dsh-capability-manager'
import { VideoShotId } from '../src/index.ts'
import { ProjectTransfers } from '../src/migration.ts'
import { resolveConfig } from '../src/config.ts'
import type { VideoClipEdit, VideoProject } from '../src/types.ts'
import { editable, imageData, projectInput, setup, shot, signal, video } from './helpers.ts'

const fixtures: Awaited<ReturnType<typeof setup>>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) await fixture.dispose()
})

async function fixture(config: Parameters<typeof setup>[0] = {}) {
  const value = await setup(config)
  fixtures.push(value)
  return value
}

async function createTarget(app: Awaited<ReturnType<typeof setup>>, name = 'restored-project') {
  const target = app.ctx.sessions.create(SessionId(name))
  await app.ctx.sessionPersistence.ensureMaterialized(target)
  return target.id
}

async function download(app: Awaited<ReturnType<typeof setup>>) {
  const ticket = await app.ctx.videoProduction.prepareProjectExport(app.sessionId, signal())
  const parts: Buffer[] = []
  for (let offset = 0; offset < ticket.bytes;) {
    const part = await app.ctx.videoProduction.readProjectTransfer(app.sessionId, ticket.id, offset, 262144, signal())
    parts.push(Buffer.from(part.data, 'base64'))
    offset = part.nextOffset
  }
  await app.ctx.videoProduction.cancelProjectTransfer(app.sessionId, ticket.id)
  return Buffer.concat(parts)
}

async function upload(app: Awaited<ReturnType<typeof setup>>, target: SessionId, bytes: Buffer) {
  const ticket = await app.ctx.videoProduction.beginProjectImport(target, bytes.length, signal())
  for (let offset = 0; offset < bytes.length; offset += 262144) {
    await app.ctx.videoProduction.writeProjectTransfer(target, ticket.id, offset, bytes.subarray(offset, offset + 262144).toString('base64'), signal())
  }
  return ticket
}

function editManifest(bytes: Buffer, change: (value: Record<string, unknown>) => void): Buffer {
  const length = bytes.readUInt32BE(10)
  const header = JSON.parse(bytes.subarray(14, 14 + length).toString('utf8')) as Record<string, unknown>
  change(header)
  const encoded = Buffer.from(JSON.stringify(header))
  const prefix = Buffer.alloc(14)
  bytes.subarray(0, 10).copy(prefix)
  prefix.writeUInt32BE(encoded.length, 10)
  return Buffer.concat([prefix, encoded, bytes.subarray(14 + length)])
}

describe('portable project packages', () => {
  it('restores references, ordered versions, selected media and detached film provenance into a new Session', async () => {
    const app = await fixture()
    const { ctx, sessionId } = app
    await ctx.plugin(CapabilityManager)
    const restoreConfiguration = vi.fn(async () => {})
    ctx.capabilities.register({
      descriptor: { id: CapabilityId('portable-fixture'), title: 'Portable fixture', description: '', category: 'video', engineId: 'fixture', kind: 'local' },
      async inspect() { return { status: 'stopped', requirements: [] } },
      async exportConfiguration() { return { workflows: [{ id: 'portrait', prompt: 'A portrait.' }] } },
      restoreConfiguration,
    })
    let project = await ctx.videoProduction.update(sessionId, projectInput())
    project = await ctx.videoProduction.addAsset(sessionId, {
      revision: project.revision, name: 'Character', description: 'Reference', kind: 'character', image: { mediaType: 'image/png', data: imageData },
    }, signal())
    const asset = project.assets[0]!
    const edit: VideoClipEdit = { trimStartSeconds: 0.25, trimEndSeconds: 1.5, volume: 0.5,
      captions: [{ startSeconds: 0.1, endSeconds: 0.8, text: 'Portable caption' }] }
    project = await ctx.videoProduction.update(sessionId, {
      ...editable(project), shots: [shot('first', { assetIds: [asset.id], edit })],
    })
    ctx.videoProduction.registerGenerator('fixture', async () => ({ attachment: await video(ctx) }), () => [{ title: 'Fixture', model: 'model', revision: 'workflow-v1' }])
    project = await ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    project = await ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    const bytes = await download(app)
    expect(bytes.includes(Buffer.from(sessionId))).toBe(false)
    expect(bytes.includes(Buffer.from(app.root))).toBe(false)
    const target = await createTarget(app)
    const packageWithFilm = editManifest(bytes, (manifest) => {
      const contents = manifest.project as { exports: unknown[] }
      contents.exports = [{ id: 'old-film', status: 'interrupted', shotVersionIds: ['deleted-shot-version'], clipEdits: [edit] }]
    })
    const ticket = await upload(app, target, packageWithFilm)
    const result = await ctx.videoProduction.commitProjectImport(target, ticket.id, signal())
    expect(result.project).toMatchObject({ title: project.title, assets: project.assets, shots: project.shots })
    expect(result.project.id).not.toBe(project.id)
    expect(result.project.sessionId).toBe(target)
    expect(result.project.exports).toEqual([{ id: 'old-film', status: 'interrupted', shotVersionIds: ['deleted-shot-version'], clipEdits: [edit] }])
    expect(result.requirements).toEqual([{ generator: 'fixture', model: 'model', revision: 'workflow-v1' }])
    expect(result.capabilities?.capabilities).toContainEqual(expect.objectContaining({ id: 'portable-fixture', configuration: { workflows: [{ id: 'portrait', prompt: 'A portrait.' }] } }))
    expect(restoreConfiguration).not.toHaveBeenCalled()
    const selected = result.project.shots[0]!.versions.at(-1)!.attachment!
    const media = await ctx.videoProduction.readMedia(target, result.project.id, selected.attachmentId, 0, 262144)
    expect(Buffer.from(media.data, 'base64')).toEqual(Buffer.from((await ctx.attachments.readVideo(selected)).data))
    await ctx.videoProduction.cancelProjectTransfer(target, ticket.id)
    await ctx.videoProduction.cancelProjectTransfer(target, ticket.id)
  })

  it('downloads an immutable snapshot in bounded slices while the source project changes', async () => {
    const app = await fixture()
    const { ctx, sessionId } = app
    await ctx.videoProduction.update(sessionId, projectInput())
    const data = Buffer.alloc(400000, 1)
    Buffer.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]).copy(data)
    const attachment = await ctx.attachments.saveVideo({ data, mediaType: 'video/mp4' })
    ctx.videoProduction.registerGenerator('fixture', async () => ({ attachment }))
    let project = await ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    const ticket = await ctx.videoProduction.prepareProjectExport(sessionId, signal())
    project = await ctx.videoProduction.update(sessionId, { ...editable(project), title: 'Edited after export' })
    const first = await ctx.videoProduction.readProjectTransfer(sessionId, ticket.id, 0, 262144, signal())
    expect(first.nextOffset).toBe(262144)
    const rest = await ctx.videoProduction.readProjectTransfer(sessionId, ticket.id, first.nextOffset, 262144, signal())
    const bytes = Buffer.concat([Buffer.from(first.data, 'base64'), Buffer.from(rest.data, 'base64')])
    expect(bytes.length).toBe(ticket.bytes)
    expect(bytes.includes(Buffer.from('Edited after export'))).toBe(false)
    await expect(ctx.videoProduction.readProjectTransfer(sessionId, ticket.id, 0, 262145, signal())).rejects.toThrow('byte range')
    await ctx.videoProduction.cancelProjectTransfer(sessionId, ticket.id)
    expect(project.title).toBe('Edited after export')
  })

  it('deduplicates identical image bytes while preserving each reference display name', async () => {
    const app = await fixture()
    let project = await app.ctx.videoProduction.update(app.sessionId, projectInput())
    for (const name of ['first.png', 'second.png']) project = await app.ctx.videoProduction.addAsset(app.sessionId, {
      revision: project.revision, name, kind: 'character', description: '', image: { mediaType: 'image/png', data: imageData, name },
    }, signal())
    expect(project.assets[0]!.image!.attachmentId).toBe(project.assets[1]!.image!.attachmentId)
    const bytes = await download(app)
    const header = JSON.parse(bytes.subarray(14, 14 + bytes.readUInt32BE(10)).toString('utf8')) as { media: unknown[] }
    expect(header.media).toHaveLength(1)
    const target = await createTarget(app)
    const ticket = await upload(app, target, bytes)
    const result = await app.ctx.videoProduction.commitProjectImport(target, ticket.id, signal())
    expect(result.project.assets.map(asset => asset.image?.name)).toEqual(['first.png', 'second.png'])
  })

  it('omits execution diagnostics and strips host directories from display filenames', async () => {
    const app = await fixture()
    const { ctx, sessionId } = app
    await ctx.videoProduction.update(sessionId, { ...projectInput(), shots: [shot('first')] })
    let fail = true
    ctx.videoProduction.registerGenerator('fixture', async () => {
      if (fail) throw new Error('C:/host-private/config.ini could not be read')
      return { attachment: { ...await video(ctx), name: 'C:\\host-private\\clip.mp4' } }
    })
    await ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    fail = false
    await ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    const bytes = await download(app)
    expect(bytes.includes(Buffer.from('host-private'))).toBe(false)
    const target = await createTarget(app)
    const ticket = await upload(app, target, bytes)
    const result = await ctx.videoProduction.commitProjectImport(target, ticket.id, signal())
    expect(result.project.shots[0]!.versions[0]).toMatchObject({ status: 'failed' })
    expect(result.project.shots[0]!.versions[0]!.error).toBeUndefined()
    expect(result.project.shots[0]!.versions[1]!.attachment?.name).toBe('clip.mp4')
  })

  it.each(['hash', 'trailing', 'selected-version', 'extra-field', 'frame-metadata', 'duplicate-media', 'edit-count', 'caption-limit'] as const)('rejects invalid packages before committing: %s', async (kind) => {
    const app = await fixture()
    const { ctx, sessionId } = app
    await ctx.videoProduction.update(sessionId, { ...projectInput(), shots: [shot('first')] })
    ctx.videoProduction.registerGenerator('fixture', async () => ({ attachment: await video(ctx) }))
    await ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    let bytes: Buffer = await download(app)
    if (kind === 'hash') { bytes = Buffer.from(bytes); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1 }
    else if (kind === 'trailing') bytes = Buffer.concat([bytes, Buffer.from('extra')])
    else bytes = editManifest(bytes, (manifest) => {
      const project = manifest.project as { shots: { selectedVersionId: string; edit?: VideoClipEdit }[]; exports: unknown[] }
      const media = manifest.media as { ref: { bytes: number } }[]
      if (kind === 'selected-version') project.shots[0]!.selectedVersionId = 'missing-version'
      else if (kind === 'extra-field') manifest.hostPath = 'C:/private'
      else if (kind === 'frame-metadata') media[0]!.ref.bytes++
      else if (kind === 'edit-count') project.exports = [{ id: 'film', status: 'interrupted', shotVersionIds: ['historical'], clipEdits: [] }]
      else if (kind === 'caption-limit') project.shots[0]!.edit = { captions: Array.from({ length: 65 }, () => ({ startSeconds: 0, endSeconds: 1, text: 'Caption' })) }
      else media.push(media[0]!)
    })
    const admission = vi.spyOn(ctx.attachments, 'saveVideo')
    const target = await createTarget(app)
    const ticket = await upload(app, target, bytes)
    await expect(ctx.videoProduction.commitProjectImport(target, ticket.id, signal())).rejects.toThrow()
    expect((await ctx.videoProduction.view(target)).revision).toBe(0)
    expect(admission).not.toHaveBeenCalled()
    await ctx.videoProduction.cancelProjectTransfer(target, ticket.id)
  })

  it('rejects foreign ownership, duplicate offsets, limits and restoring over a newly saved target', async () => {
    const app = await fixture({ maxProjectTransfers: 1, maxProjectPackageBytes: 4096 })
    const { ctx, sessionId } = app
    await ctx.videoProduction.update(sessionId, { ...projectInput(), shots: [] })
    const bytes = await download(app)
    const target = await createTarget(app)
    const ticket = await ctx.videoProduction.beginProjectImport(target, bytes.length, signal())
    await expect(ctx.videoProduction.beginProjectImport(target, bytes.length, signal())).rejects.toThrow('maxProjectTransfers')
    await expect(ctx.videoProduction.writeProjectTransfer(sessionId, ticket.id, 0, bytes.toString('base64'), signal())).rejects.toThrow('matching')
    await expect(ctx.videoProduction.cancelProjectTransfer(sessionId, ticket.id)).rejects.toThrow('matching')
    await expect(ctx.videoProduction.writeProjectTransfer(target, ticket.id, 0, 'not base64', signal())).rejects.toThrow('invalid')
    const writes = await Promise.allSettled([
      ctx.videoProduction.writeProjectTransfer(target, ticket.id, 0, bytes.toString('base64'), signal()),
      ctx.videoProduction.writeProjectTransfer(target, ticket.id, 0, bytes.toString('base64'), signal()),
    ])
    expect(writes.map(item => item.status)).toEqual(['fulfilled', 'rejected'])
    await ctx.videoProduction.update(target, { ...projectInput(), title: 'Do not overwrite', shots: [] })
    await expect(ctx.videoProduction.commitProjectImport(target, ticket.id, signal())).rejects.toThrow('without an existing')
    expect((await ctx.videoProduction.view(target)).title).toBe('Do not overwrite')
    await expect(ctx.videoProduction.beginProjectImport(target, 4097, signal())).rejects.toThrow('byte limit')
  })

  it('classifies interrupted attempts and refuses tickets from an earlier service lifetime', async () => {
    const app = await fixture()
    await app.ctx.videoProduction.update(app.sessionId, projectInput())
    const bytes = editManifest(await download(app), (manifest) => {
      const project = manifest.project as { shots: { versions: unknown[] }[] }
      project.shots[0]!.versions.push({ id: 'pending', status: 'running', prompt: 'Pending', duration: 1, aspectRatio: '16:9', resolution: '480p', referenceImages: [] })
    })
    const target = await createTarget(app)
    const ticket = await upload(app, target, bytes)
    const result = await app.ctx.videoProduction.commitProjectImport(target, ticket.id, signal())
    expect(result.project.shots[0]!.versions[0]).toMatchObject({ status: 'interrupted' })
    const downloadTicket = await app.ctx.videoProduction.prepareProjectExport(target, signal())
    await app.dispose(false)
    fixtures.splice(fixtures.indexOf(app), 1)
    const reopened = await setup({}, app.root)
    fixtures.push(reopened)
    await expect(reopened.ctx.videoProduction.readProjectTransfer(target, downloadTicket.id, 0, 10, signal())).rejects.toThrow('matching')
    expect(await reopened.ctx.videoProduction.view(target)).toEqual(result.project)
  })

  it('serializes a blocked write, duplicate write and cancellation to quiescence', async () => {
    const app = await fixture()
    const current: VideoProject = { ...(await app.ctx.videoProduction.view(app.sessionId)), title: 'Empty target' }
    const blocked = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let hold = false
    const load = vi.fn(async () => {
      if (hold) { hold = false; blocked.resolve(undefined); await release.promise }
      return { project: current, sessionCreatedAt: 1 }
    })
    const transfers = new ProjectTransfers(app.ctx, resolveConfig({}), { load, restore: async project => project })
    try {
      const ticket = await transfers.beginImport(app.sessionId, 100, signal())
      hold = true
      const first = transfers.write(app.sessionId, ticket.id, 0, Buffer.alloc(50).toString('base64'), signal())
      await blocked.promise
      const duplicate = transfers.write(app.sessionId, ticket.id, 0, Buffer.alloc(50, 1).toString('base64'), signal())
      void duplicate.catch(() => {})
      const cancelled = transfers.cancel(app.sessionId, ticket.id)
      release.resolve(undefined)
      expect((await first).nextOffset).toBe(50)
      await expect(duplicate).rejects.toThrow('offset')
      await cancelled
      await expect(transfers.read(app.sessionId, ticket.id, 0, 1, signal())).rejects.toThrow('matching')
      await transfers.cancel(app.sessionId, ticket.id)
    } finally { release.resolve(undefined); await transfers.close() }
  })

  it('rejects a transfer after its Session lifecycle changes without committing data', async () => {
    const app = await fixture()
    const project = await app.ctx.videoProduction.view(app.sessionId)
    let createdAt = 1
    const transfers = new ProjectTransfers(app.ctx, resolveConfig({}), {
      async load() { return { project, sessionCreatedAt: createdAt } }, restore: vi.fn(),
    })
    try {
      const ticket = await transfers.beginImport(app.sessionId, 20, signal())
      createdAt = 2
      await expect(transfers.write(app.sessionId, ticket.id, 0, Buffer.alloc(20).toString('base64'), signal())).rejects.toThrow('earlier Session')
      await transfers.cancel(app.sessionId, ticket.id)
    } finally { await transfers.close() }
  })

  it('expires retained transfers and releases their admission slot', async () => {
    const app = await fixture()
    const project = await app.ctx.videoProduction.view(app.sessionId)
    const transfers = new ProjectTransfers(app.ctx, resolveConfig({ maxProjectTransfers: 1, projectTransferTimeoutMs: 10 }), {
      async load() { return { project, sessionCreatedAt: 1 } }, restore: vi.fn(),
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const ticket = await transfers.beginImport(app.sessionId, 20, signal())
      await vi.advanceTimersByTimeAsync(11)
      await transfers.cancel(app.sessionId, ticket.id)
      await expect(transfers.write(app.sessionId, ticket.id, 0, Buffer.alloc(20).toString('base64'), signal())).rejects.toThrow('matching')
      const replacement = await transfers.beginImport(app.sessionId, 20, signal())
      expect(replacement.id).not.toBe(ticket.id)
    } finally { await transfers.close(); vi.useRealTimers() }
  })

  it('waits for interrupted attachment admission and leaves no partially restored project', async () => {
    const app = await fixture()
    const { ctx, sessionId } = app
    await ctx.videoProduction.update(sessionId, { ...projectInput(), shots: [shot('first')] })
    ctx.videoProduction.registerGenerator('fixture', async () => ({ attachment: await video(ctx) }))
    await ctx.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    const bytes = await download(app)
    const target = await createTarget(app)
    const ticket = await upload(app, target, bytes)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const original = ctx.attachments.saveVideo.bind(ctx.attachments)
    vi.spyOn(ctx.attachments, 'saveVideo').mockImplementation(async (request, active) => {
      entered.resolve(undefined)
      await release.promise
      return original(request, active)
    })
    const controller = new AbortController()
    const restore = ctx.videoProduction.commitProjectImport(target, ticket.id, controller.signal)
    void restore.catch(() => {})
    try {
      await entered.promise
      controller.abort(new Error('Caller cancelled restore'))
      release.resolve(undefined)
      await expect(restore).rejects.toThrow('Caller cancelled restore')
      expect((await ctx.videoProduction.view(target)).revision).toBe(0)
      await ctx.videoProduction.cancelProjectTransfer(target, ticket.id)
    } finally { release.resolve(undefined); await Promise.allSettled([restore]) }
  })
})
