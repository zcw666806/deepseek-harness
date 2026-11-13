import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import ComicProduction from '../src/index.ts'
import type { ComicDraft, ComicProject } from '../src/types.ts'

async function host(root: string) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none', writeBatchMaxDelayMs: 1 })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(ComicProduction, { dshHome: root })
  return ctx
}

async function attach(ctx: Context, workspace: Workspace, name: string) {
  const id = SessionId(name)
  await ctx.sessionPersistence.ensureMaterialized(ctx.sessions.create(id, { meta: { cwd: workspace.path } }))
  await workspace.attachSession(id)
  return id
}

async function withHost(run: (ctx: Context, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-comic-test-'))
  let ctx: Context | undefined
  try {
    ctx = await host(root)
    await run(ctx, root)
  } finally {
    await ctx?.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

function draft({ title, pages }: ComicProject): ComicDraft {
  return { title, pages }
}

function png(red: number, width = 4) {
  return sharp({ create: { width, height: 3, channels: 4, background: { r: red, g: 12, b: 31, alpha: 0.5 } } }).png().toBuffer()
}

it('reopens the same manuscript from a new Session in its Workspace and fences stale edits', async () => {
  await withHost(async (ctx, root) => {
    const otherRoot = join(root, 'other')
    await mkdir(otherRoot)
    const first = await ctx.workspaceRegistry.create(root)
    const second = await ctx.workspaceRegistry.create(otherRoot)
    const initialSession = await attach(ctx, first, 'comic-first')
    const nextSession = await attach(ctx, first, 'comic-next')
    const unrelated = await attach(ctx, second, 'comic-unrelated')
    const service = ctx.comicProduction
    const project = await service.create(initialSession, 'The handoff')
    expect(project.pages).toHaveLength(3)
    expect(service.list(nextSession)).toEqual([{ id: project.id, title: project.title, revision: 1 }])
    expect(service.list(unrelated)).toEqual([])
    expect(() => service.open(unrelated, project.id)).toThrow('The manuscript is not in this Workspace.')
    const saved = await service.save(nextSession, project.id, project.revision, { ...draft(project), title: 'The new draft' })
    await expect(service.save(initialSession, project.id, project.revision, draft(project))).rejects.toMatchObject({ details: { reason: 'revision-conflict' } })
    expect(service.open(initialSession, project.id)).toEqual(saved)
    const firstPage = saved.pages[0]!
    const invalidPanel = { ...firstPage.panels[0]!, x: firstPage.width }
    await expect(service.save(initialSession, saved.id, saved.revision, {
      ...draft(saved), pages: [{ ...firstPage, panels: [invalidPanel] }, ...saved.pages.slice(1)],
    })).rejects.toMatchObject({ details: { reason: 'draft-invalid' } })
    expect(service.open(initialSession, project.id)).toEqual(saved)
  })
})

it('retains original PNG versions, checks replacement dimensions, and imports an independent package', async () => {
  await withHost(async (ctx, root) => {
    const workspace = await ctx.workspaceRegistry.create(root)
    const session = await attach(ctx, workspace, 'comic-artwork')
    const service = ctx.comicProduction
    const project = await service.create(session, 'Two drawings')
    const panel = project.pages[0]!.panels[0]!
    const layer = panel.layers[0]!
    const original = await png(22)
    const corrected = await png(231)
    const differentSize = await png(88, 5)
    const first = await service.saveLayerImage(session, project.id, project.revision, panel.id, layer.id, original.toString('base64'))
    await expect(service.saveLayerImage(session, project.id, first.revision, panel.id, layer.id, differentSize.toString('base64')))
      .rejects.toMatchObject({ details: { reason: 'image-dimensions' } })
    const second = await service.saveLayerImage(session, project.id, first.revision, panel.id, layer.id, corrected.toString('base64'))
    const savedLayer = second.pages[0]!.panels[0]!.layers[0]!
    expect(savedLayer.versions).toHaveLength(2)
    expect(savedLayer.imageId).toBe(savedLayer.versions[1]!.id)
    const originalId = savedLayer.versions[0]!.id
    const head = await service.readImage(session, project.id, originalId, 0, 9)
    expect(head).toMatchObject({ offset: 0, nextOffset: 9, done: false })
    const tail = await service.readImage(session, project.id, originalId, head.nextOffset, original.length)
    expect(tail.done).toBe(true)
    expect(Buffer.concat([Buffer.from(head.data, 'base64'), Buffer.from(tail.data, 'base64')])).toEqual(original)
    const portable = await service.exportProject(session, project.id)
    const bad = { ...portable, images: [{ id: portable.images[0]!.id, data: corrected.toString('base64') }, portable.images[1]!] }
    await expect(service.importProject(session, bad)).rejects.toMatchObject({ details: { reason: 'package-images' } })
    expect(service.list(session)).toHaveLength(1)
    const imported = await service.importProject(session, portable)
    expect(imported.id).not.toBe(project.id)
    expect(draft(imported)).toEqual(draft(second))
    expect(await service.exportProject(session, imported.id)).toEqual(portable)
  })
})
