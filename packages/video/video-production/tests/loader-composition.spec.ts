import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { SessionId } from '@deepseek-ai/dsh-session'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { VideoShotId } from '../src/index.ts'
import { modules, projectInput, signal, video } from './helpers.ts'

let root: string | undefined
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function load(path: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected test Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
  return ctx
}

describe('video production through a real Loader composition', () => {
  it('contributes its model tool and RPCs and preserves generated media through a cold restart', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-video-production-loader-'))
    const path = join(root, 'cordis.yml')
    await writeFile(path, JSON.stringify([
      { name: 'sessions' },
      { name: 'persistence', config: { root: join(root, 'sessions'), compression: 'none', writeBatchMaxDelayMs: 1 } },
      { name: 'storage' }, { name: 'storage-json', config: { root: join(root, 'storage') } },
      { name: 'storage-domain', config: { backend: 'json' } },
      { name: 'attachments', config: { dshHome: root } }, { name: 'system-prompt' }, { name: 'tools' },
      { name: 'video-production' },
    ]))
    const first = await load(path)
    const sessionId = SessionId('loader-video-production')
    const session = first.sessions.create(sessionId, { meta: { cwd: root } })
    await first.sessionPersistence.ensureMaterialized(session)
    expect(first.videoProduction.typertRemote.namespace).toBe('videoProduction')
    expect(remoteMethods(first.videoProduction).map(marker => marker.method)).toEqual([
      'generationTargets', 'startBatch', 'batch', 'listBatches', 'pauseBatch', 'cancelBatch', 'resumeBatch',
      'projectSummaries', 'view', 'update', 'addAsset', 'reorder', 'generate', 'export', 'readMedia',
      'prepareProjectExport', 'readProjectTransfer', 'beginProjectImport', 'writeProjectTransfer', 'commitProjectImport', 'cancelProjectTransfer',
    ])
    expect(first.tools.schemas().find(schema => schema.name === 'video_project')).toBeDefined()
    await first.videoProduction.update(sessionId, projectInput())
    first.videoProduction.registerGenerator('recorded-provider', async request => ({
      attachment: await video(first, request.prompt.length), model: 'recorded-video',
    }))
    let project = await first.videoProduction.generate(sessionId, VideoShotId('first'), {}, signal())
    const batch = await first.videoProduction.startBatch(sessionId, { revision: project.revision })
    await vi.waitFor(async () =>{  expect((await first.videoProduction.batch(sessionId))?.status).toBe('completed') })
    project = await first.videoProduction.view(sessionId)
    const attachment = project.shots[0]!.versions[0]!.attachment!
    const before = await first.videoProduction.readMedia(sessionId, project.id, attachment.attachmentId, 0, 262144)
    const packageTicket = await first.videoProduction.prepareProjectExport(sessionId, signal())
    const packageParts: Buffer[] = []
    for (let offset = 0; offset < packageTicket.bytes;) {
      const part = await first.videoProduction.readProjectTransfer(sessionId, packageTicket.id, offset, 262144, signal())
      packageParts.push(Buffer.from(part.data, 'base64'))
      offset = part.nextOffset
    }
    await first.videoProduction.cancelProjectTransfer(sessionId, packageTicket.id)
    const restoredSession = first.sessions.create(SessionId('loader-restored-project'))
    await first.sessionPersistence.ensureMaterialized(restoredSession)
    const packageBytes = Buffer.concat(packageParts)
    const upload = await first.videoProduction.beginProjectImport(restoredSession.id, packageBytes.length, signal())
    for (let offset = 0; offset < packageBytes.length; offset += 262144) await first.videoProduction.writeProjectTransfer(
      restoredSession.id, upload.id, offset, packageBytes.subarray(offset, offset + 262144).toString('base64'), signal(),
    )
    const restored = await first.videoProduction.commitProjectImport(restoredSession.id, upload.id, signal())
    expect(restored.project).toMatchObject({ title: project.title, shots: project.shots, exports: project.exports })
    expect(restored.project.id).not.toBe(project.id)
    expect(restored.project.sessionId).toBe(restoredSession.id)
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)
    const second = await load(path)
    expect(second.sessions.get(sessionId)).toBeUndefined()
    expect((await second.videoProduction.batch(sessionId))?.id).toBe(batch.id)
    expect((await second.videoProduction.batch(sessionId))?.status).toBe('completed')
    await expect(second.videoProduction.view(sessionId)).resolves.toEqual(project)
    await expect(second.videoProduction.view(restoredSession.id)).resolves.toEqual(restored.project)
    await expect(second.videoProduction.readMedia(sessionId, project.id, attachment.attachmentId, 0, 262144)).resolves.toEqual(before)
  })
})
