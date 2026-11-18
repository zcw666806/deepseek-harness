import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import SessionStore, { SessionId, type AssistantMessage, type Session, type UserMessage } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import ComicProduction from '../src/index.ts'
import { readStoryboard, storyboardPackage } from '../src/storyboard.ts'
import type { ComicBubbleId, ComicDraft, ComicLayerId, ComicPageId, ComicPanel, ComicPanelId, ComicProject, Config } from '../src/types.ts'

async function host(root: string, config?: Config) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none', writeBatchMaxDelayMs: 1 })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(WorkspaceRegistry)
  if (config?.imageGeneration != null || config?.imageGenerationTargets !== undefined) {
    ctx.provide('credentials', {
      resolve: async (ref: string) => ref === 'COMIC_TEST_KEY' ? { value: 'fixture-image-key', source: 'fixture' } : undefined,
    } as never)
  }
  await ctx.plugin(ComicProduction, { dshHome: root, ...config })
  return ctx
}

async function attach(ctx: Context, workspace: Workspace, name: string) {
  const id = SessionId(name)
  await ctx.sessionPersistence.ensureMaterialized(ctx.sessions.create(id, { meta: { cwd: workspace.path } }))
  await workspace.attachSession(id)
  return id
}

async function withHost(run: (ctx: Context, root: string) => Promise<void>, config?: Config): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-comic-test-'))
  let ctx: Context | undefined
  try {
    ctx = await host(root, config)
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

const storyboardReply = `《给自己留一盏灯》
暖黄、水粉，四格的小刺猬造型一致。

第一格
画面：小刺猬在夜色里走向家门。
动作：小刺猬手里提着空灯笼。
对白：无

第二格
画面：窗边留着一盏暖色小灯。
动作：小刺猬抬头望向窗户。
对白：还亮着。

第三格
画面：小刺猬拿起桌上的便签。
动作：便签写着「到家啦」。
对白：无

第四格
画面：满屋暖光。
动作：小刺猬在灯旁坐下。
对白：无`

it('keeps standalone storyboard document links out of art direction and dialogue', () => {
  const reply = `[分镜文档](storyboard.md)\n${storyboardReply}`
    .replace('对白：还亮着。', '对白：还亮着。\n[图书馆](./library.md)')
    + '\n\n[查看分镜文档](<comics/给自己留一盏灯 初稿/storyboard.md>)'
  const storyboard = readStoryboard(reply)
  expect(storyboard?.artDirection).toBe('暖黄、水粉，四格的小刺猬造型一致。')
  const panels = storyboardPackage(storyboard!, 'Untitled comic', 'Illustration').draft.pages[0]!.panels
  expect(panels[1]!.bubbles[0]!.text).toBe('还亮着。\n[图书馆](./library.md)')
  expect(panels[3]!.bubbles).toEqual([])
})

function appendStoryboardTurn(
  session: Session, turn: number, text: string, options: { readonly synthetic?: boolean; readonly interrupted?: boolean } = {},
): AssistantMessage['id'] {
  const user: UserMessage = {
    id: brandString<UserMessage['id']>(randomUUID()), role: 'user', content: [{ type: 'text', text }],
    source: options.synthetic === true ? { kind: 'plugin', plugin: 'test' } : { kind: 'user' },
  }
  const assistant: AssistantMessage = {
    id: brandString<AssistantMessage['id']>(randomUUID()), role: 'assistant', content: [{ type: 'text', text: storyboardReply }],
    source: { kind: 'model', model: 'test', provider: 'test' },
  }
  session.append('turn/start', { turn })
  session.append('user/message', user, { surfaceOp: 'append' })
  session.append('step/start', { turn, step: 1 })
  session.append('assistant/message', {
    turn, step: 1, message: assistant, ...(options.interrupted === true ? { interrupted: true } : {}),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: options.interrupted === true ? { kind: 'aborted', reason: { kind: 'user' } } : { kind: 'completed' } })
  return assistant.id
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

it('uses the Session image model for manual and automatic rendering and retains editable layers', async () => {
  const colors = [32, 84, 150, 225]
  const art = await Promise.all(colors.map(color => png(color)))
  const sheet = await sharp({ create: { width: 8, height: 6, channels: 4, background: 'white' } })
    .composite(art.map((input, index) => ({ input, left: (index % 2) * 4, top: Math.floor(index / 2) * 3 }))).jpeg().toBuffer()
  const requests: { authorization?: string | undefined; path?: string | undefined; body: unknown }[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      requests.push({ authorization: request.headers.authorization, path: request.url, body: JSON.parse(body) })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ data: [{ b64_json: sheet.toString('base64'), url: null }] }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Image fixture did not bind a TCP port.')
    const baseURL = `http://127.0.0.1:${address.port}`
    const imageGeneration = { baseURL: `${baseURL}/default/v1`, credentialRef: 'COMIC_TEST_KEY', model: 'legacy-image-model' }
    const imageGenerationTargets = [
      { id: 'alternate', title: 'Alternate artist', baseURL: `${baseURL}/alternate/v1`, credentialRef: 'COMIC_TEST_KEY', model: 'test-image-model' },
      { id: 'unavailable', title: 'Unconfigured artist', baseURL, credentialRef: 'MISSING_KEY', model: 'unavailable-model' },
    ]
    await withHost(async (ctx, root) => {
      const workspace = await ctx.workspaceRegistry.create(root)
      const session = await attach(ctx, workspace, 'comic-generation')
      const secondSession = await attach(ctx, workspace, 'comic-other-session')
      const service = ctx.comicProduction
      const panels: ComicPanel[] = colors.map((color, index) => ({
        id: brandString<ComicPanelId>(randomUUID()),
        x: (index % 2) * 500, y: Math.floor(index / 2) * 500, width: 500, height: 500,
        description: `场景 ${color}`, notes: '',
        layers: [{ id: brandString<ComicLayerId>(randomUUID()), name: '', visible: true, versions: [], imageId: null }],
        bubbles: index === 1 ? [{ id: brandString<ComicBubbleId>(randomUUID()), x: 24, y: 24, width: 120, height: 40, text: '还亮着。', speaker: '' }] : [],
      }))
      const storyboard: ComicDraft = {
        title: '给自己留一盏灯',
        pages: [{ id: brandString<ComicPageId>(randomUUID()), title: '', width: 1_000, height: 1_000, panels }],
      }
      const targets = await service.storyboardGenerationTargets()
      expect(targets).toEqual([
        { id: 'default', title: 'legacy-image-model', model: 'legacy-image-model' },
        { id: 'alternate', title: 'Alternate artist', model: 'test-image-model' },
      ])
      const target = targets.find(item => item.id === 'alternate')!
      expect(await service.storyboardGenerationTarget(session)).toBeUndefined()
      expect(await service.storyboardGenerationAvailable(session)).toBe(false)
      await expect(service.generateStoryboard(session, 'source-a', storyboard, '暖黄、水粉')).rejects
        .toMatchObject({ details: { reason: 'generation-unavailable' } })
      await expect(service.selectStoryboardGenerationTarget(SessionId('unattached'), target.id)).rejects
        .toMatchObject({ details: { reason: 'workspace-required' } })
      expect(requests).toHaveLength(0)
      await service.selectStoryboardGenerationTarget(session, target.id)
      expect(await service.storyboardGenerationTarget(session)).toBe(target.id)
      expect(await service.storyboardGenerationAvailable(session)).toBe(true)
      expect(await service.storyboardGenerationTarget(secondSession)).toBeUndefined()
      expect(await service.storyboardResult(session, 'source-a')).toBeUndefined()
      await expect(service.generateStoryboard(session, 'invalid-source', { ...storyboard, pages: [] }, '')).rejects
        .toMatchObject({ details: { reason: 'storyboard-invalid' } })
      const [result, duplicate, joined] = await Promise.all([
        service.generateStoryboard(session, 'source-a', storyboard, '暖黄、水粉'),
        service.generateStoryboard(session, 'source-a', storyboard, '暖黄、水粉'),
        service.storyboardResult(session, 'source-a'),
      ])
      expect(duplicate.id).toBe(result.id)
      expect(joined).toEqual(result)
      expect(requests).toMatchObject([{ authorization: 'Bearer fixture-image-key', path: '/alternate/v1/images/generations', body: {
        model: 'test-image-model', n: 1, response_format: 'b64_json', aspect_ratio: '1:1',
        prompt: expect.stringContaining('暖黄、水粉'),
      } }])
      const illustrated = result.pages[0]!.panels
      expect(new Set(illustrated.map(panel => panel.layers[0]!.imageId)).size).toBe(4)
      for (const panel of illustrated) {
        expect(panel.layers[0]!.versions[0]).toMatchObject({ width: 4, height: 3 })
      }
      expect(illustrated[1]!.bubbles[0]!.text).toBe('还亮着。')
      const changed = illustrated.map((panel, index) => index === 1
        ? { ...panel, bubbles: [{ ...panel.bubbles[0]!, text: '灯还亮着。' }] } : panel)
      const saved = await service.save(session, result.id, result.revision, {
        ...draft(result), pages: [{ ...result.pages[0]!, panels: changed }],
      })
      expect(await service.storyboardResult(session, 'source-a')).toEqual(saved)
      expect(await service.generateStoryboard(session, 'source-a', storyboard, '暖黄、水粉')).toEqual(saved)
      expect(await service.storyboardResult(secondSession, 'source-a')).toBeUndefined()
      expect(requests).toHaveLength(1)
      const live = ctx.sessions.get(session)!
      const rejected = [
        appendStoryboardTurn(live, 1, '请帮我画一张四格漫画《给自己留一盏灯》，分镜先给我看'),
        appendStoryboardTurn(live, 2, '如何画一张治愈系四格漫画？'),
        appendStoryboardTurn(live, 3, '请解释这个示例。\n```text\n请画一张四格漫画《给自己留一盏灯》\n```'),
        appendStoryboardTurn(live, 4, '「请画一张四格漫画《给自己留一盏灯》」这句话可以怎么改？'),
        appendStoryboardTurn(live, 5, '请画一张四格漫画《给自己留一盏灯》', { synthetic: true }),
        appendStoryboardTurn(live, 6, '请画一张四格漫画《给自己留一盏灯》', { interrupted: true }),
      ]
      for (const sourceMessage of rejected) expect(await service.storyboardResult(session, sourceMessage)).toBeUndefined()
      expect(requests).toHaveLength(1)
      const sourceMessage = appendStoryboardTurn(live, 7, '想画个治愈系漫画《给自己留一盏灯》')
      const automatic = await service.storyboardResult(session, sourceMessage)
      expect(automatic).toMatchObject({ title: '给自己留一盏灯', pages: [{ panels: expect.any(Array) }] })
      expect(automatic?.pages[0]?.panels[1]?.bubbles[0]?.text).toBe('还亮着。')
      expect(requests).toHaveLength(2)
      expect(requests[1]).toMatchObject({ path: '/alternate/v1/images/generations', body: { model: 'test-image-model' } })
      const replay = ctx.sessions.create(SessionId('comic-replayed'), { seed: live.events, meta: { cwd: workspace.path } })
      await ctx.sessionPersistence.ensureMaterialized(replay)
      await workspace.attachSession(replay.id)
      expect(await service.storyboardResult(replay.id, sourceMessage)).toBeUndefined()
      expect(requests).toHaveLength(2)

      await ctx.fiber.dispose()
      const reopened = await host(root, { imageGeneration })
      try {
        expect(await reopened.comicProduction.storyboardGenerationTarget(session)).toBe(target.id)
        expect(await reopened.comicProduction.storyboardGenerationAvailable(session)).toBe(false)
        expect(await reopened.comicProduction.storyboardGenerationTarget(secondSession)).toBe('default')
        expect(await reopened.comicProduction.storyboardGenerationAvailable(secondSession)).toBe(true)
      } finally {
        await reopened.fiber.dispose()
      }
    }, { imageGeneration, imageGenerationTargets })
  } finally {
    const closed = once(server, 'close')
    server.close()
    server.closeAllConnections()
    await closed
  }
})
