import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import CapabilityManager, { CapabilityId } from '@deepseek-ai/dsh-capability-manager'
import FileSettings from '@deepseek-ai/dsh-settings-file'
import VideoProduction, { VideoShotId } from '@deepseek-ai/dsh-video-production'
import * as ComfyProvider from '../src/index.ts'
import { fixture, json, mp4, workflow } from './fixture.ts'
import type { Config } from '../src/types.ts'

const disposers: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })

async function load(config: Config, portable = false) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-comfyui-loader-'))
  const ctx = new Context()
  disposers.push(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const modules = new Map<string, unknown>([
    ['sessions', SessionStore], ['persistence', JsonlSessionPersistence], ['storage', Storage],
    ['storage-json', StorageJson], ['storage-domain', StorageDomain], ['attachments', LocalAttachmentStore],
    ['system-prompt', SystemPrompt], ['tools', ToolRuntime], ['video-production', VideoProduction], ['video-comfyui', ComfyProvider],
    ['capabilities', CapabilityManager], ['settings', FileSettings],
  ])
  const path = join(root, 'cordis.yml')
  await writeFile(path, JSON.stringify([
    { name: 'sessions' }, { name: 'persistence', config: { root: join(root, 'sessions'), compression: 'none', writeBatchMaxDelayMs: 1 } },
    { name: 'storage' }, { name: 'storage-json', config: { root: join(root, 'storage') } },
    { name: 'storage-domain', config: { backend: 'json' } }, { name: 'attachments', config: { dshHome: root } },
    { name: 'system-prompt' }, { name: 'tools' }, { name: 'video-production' },
    ...portable ? [{ name: 'capabilities' }, { name: 'settings', config: { path: join(root, 'settings.json'), watch: false } }] : [],
    { id: 'provider', name: 'video-comfyui', config },
  ]))
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected fixture import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
  const sessionId = SessionId('comfyui-loader-session')
  const session = ctx.sessions.create(sessionId, { meta: { cwd: root } })
  await ctx.sessionPersistence.ensureMaterialized(session)
  await ctx.videoProduction.update(sessionId, {
    revision: 0, title: 'ComfyUI project', assets: [], shots: [{
      id: VideoShotId('shot'), title: 'First shot', prompt: 'Friends wave.', duration: 2,
      aspectRatio: '16:9', resolution: '480p', assetIds: [], position: { x: 0, y: 0 },
    }],
  })
  const provider = [...ctx.loader.entries()].find(entry => entry.options.id === 'provider')!
  return { ctx, sessionId, provider, settingsPath: join(root, 'settings.json') }
}

describe('ComfyUI provider through an actual Loader composition', () => {
  it('keeps editor writes isolated between independent Loader settings owners', async () => {
    const first = await load({}, true)
    const second = await load({}, true)
    const initial = await first.ctx.videoWorkflows.view()
    expect(initial.configuration).toEqual({ workflows: [] })
    expect(initial.templates).toMatchObject([{ category: 'diagnostic', workflow: { id: 'managed-native-black' } }])
    expect(initial.templates[0]!.workflow.title).toContain('not AI')
    await expect(first.ctx.videoWorkflows.validate({ baseURL: 'http://localhost:8188', workflows: [initial.templates[0]!.workflow] })).resolves.toEqual({ valid: true })
    await expect(first.ctx.videoWorkflows.setEnabled(true, initial.revision)).rejects.toMatchObject({ code: 'video-workflows/invalid' })
    const updated = await first.ctx.videoWorkflows.save({ baseURL: 'http://localhost:8188', workflows: [workflow()] }, initial.revision)
    expect(updated).toMatchObject({ enabled: false, configuration: { workflows: [{ id: 'owned' }] } })
    expect(await second.ctx.videoWorkflows.view()).toEqual(initial)
    expect(first.ctx.videoProduction.generationTargets()).toEqual([])
    expect(second.ctx.videoProduction.generationTargets()).toEqual([])
    const concurrent = await Promise.allSettled(['One', 'Two'].map(title => first.ctx.videoWorkflows.save({
      ...updated.configuration, workflows: [{ ...workflow(), title }],
    }, updated.revision)))
    expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(concurrent.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { code: 'video-workflows/conflict' } }])
  })

  it('edits safe workflows with revision conflicts and explicit offline activation', async () => {
    const http = await fixture()
    disposers.push(() => http.close())
    const app = await load(http.config({ headers: { authorization: 'local-secret' }, managedCapability: 'comfy-runtime' }), true)
    const initial = await app.ctx.videoWorkflows.view()
    expect(initial).toMatchObject({ enabled: true, hasHeaders: true, configuration: { baseURL: http.baseURL } })
    expect(JSON.stringify(initial)).not.toContain('local-secret')
    expect(JSON.stringify(app.ctx.settings.describe({ redactSecrets: true }))).not.toContain('local-secret')
    const edited = { ...initial.configuration, workflows: [{ ...workflow(), title: 'Edited workflow' }] }
    expect(await app.ctx.videoWorkflows.validate(edited)).toEqual({ valid: true })
    expect(await app.ctx.videoWorkflows.view()).toEqual(initial)
    const saved = await app.ctx.videoWorkflows.save(edited, initial.revision)
    expect(saved.enabled).toBe(false)
    expect(saved.revision).toBeGreaterThan(initial.revision)
    expect(app.ctx.videoProduction.generationTargets()).toEqual([])
    await expect(app.ctx.videoWorkflows.save(edited, initial.revision)).rejects.toMatchObject({
      code: 'video-workflows/conflict', details: { expected: initial.revision, actual: saved.revision },
    })
    const enabled = await app.ctx.videoWorkflows.setEnabled(true, saved.revision)
    expect(enabled.enabled).toBe(true)
    expect(app.ctx.videoProduction.generationTargets()).toMatchObject([{ title: 'Edited workflow' }])
    expect(http.state.requests).toEqual([])
    const descriptor = app.ctx.settings.describe().find(item => item.ns === 'video-comfyui')!
    expect(descriptor.value).toMatchObject({ managedCapability: 'comfy-runtime', headers: { authorization: 'local-secret' } })
    await app.ctx.videoWorkflows.setEnabled(false, enabled.revision)
    expect(app.ctx.videoProduction.generationTargets()).toEqual([])
    await app.provider.fiber!.dispose()
    expect(app.ctx.get('videoWorkflows')).toBeUndefined()
  })

  it('refuses unsafe editor payloads without persisting or returning sensitive values', async () => {
    const http = await fixture()
    disposers.push(() => http.close())
    const app = await load(http.config(), true)
    const initial = await app.ctx.videoWorkflows.view()
    const invalid = [
      { ...initial.configuration, headers: { authorization: 'hidden-secret' } },
      { ...initial.configuration, baseURL: 'http://user:hidden-secret@localhost' },
      { ...initial.configuration, workflows: [{ ...workflow(), prompt: { node: 'missing', input: 'text' } }] },
      { ...initial.configuration, workflows: [{ ...workflow(), template: { '1': { class_type: 'OperatorVideo', inputs: { text: '', seconds: 2, width: 854, height: 480, prefix: '', api_key: 'hidden-secret' } } } }] },
      { ...initial.configuration, workflows: [{ ...workflow(), template: { nodes: [] } }] },
    ]
    for (const value of invalid) {
      await expect(app.ctx.videoWorkflows.validate(value)).rejects.toMatchObject({ code: 'video-workflows/invalid' })
      await expect(app.ctx.videoWorkflows.save(value, initial.revision)).rejects.toThrow('Remove credentials')
    }
    await expect(app.ctx.videoWorkflows.save(initial.configuration, -1)).rejects.toMatchObject({ code: 'video-workflows/invalid' })
    expect(await app.ctx.videoWorkflows.view()).toEqual(initial)
    expect(http.state.requests).toEqual([])
    await app.ctx.settings.update('video-comfyui', { workflows: invalid[3]!.workflows })
    await expect(app.ctx.videoWorkflows.view()).rejects.toThrow('Remove credentials')
  })

  it('restores workflows through the capability center while retaining target credentials and waiting for explicit activation', async () => {
    const origin = await fixture()
    const target = await fixture((request, response) => {
      if (!request.url!.startsWith('/object_info/')) return false
      json(response, { OperatorVideo: { input: { required: {} } } })
      return true
    })
    disposers.push(() => origin.close(), () => target.close())
    const first = await load(origin.config({ headers: { authorization: 'origin-secret' } }), true)
    const second = await load(target.config({ headers: { authorization: 'target-secret' } }), true)
    const manifest = await first.ctx.capabilities.exportManifest(new AbortController().signal)
    const text = JSON.stringify(manifest)
    expect(text).not.toContain('origin-secret')
    expect(text).not.toContain(origin.baseURL)
    expect(second.ctx.settings.describe()).toContainEqual(expect.objectContaining({ ns: 'video-comfyui' }))
    expect(await second.ctx.capabilities.restoreManifest(manifest, new AbortController().signal)).toEqual(expect.arrayContaining([
      { id: 'video.comfyui', status: 'restored' },
    ]))
    expect(second.ctx.videoProduction.generationTargets()).toEqual([])
    expect(target.state.requests).toEqual([])
    const stored = await readFile(second.settingsPath, 'utf8')
    expect(stored).not.toContain('origin-secret')
    expect(stored).not.toContain(origin.baseURL)
    expect(await second.ctx.capabilities.perform(CapabilityId('video.comfyui'), 'start', new AbortController().signal)).toMatchObject({ status: 'ready' })
    const project = await second.ctx.videoProduction.generate(second.sessionId, VideoShotId('shot'), { generator: 'comfyui', model: 'owned' }, new AbortController().signal)
    expect(project.shots[0]?.versions[0]?.status).toBe('completed')
    expect(target.state.submissions).toHaveLength(1)
    expect(target.state.requests.every(request => request.authorization === 'target-secret')).toBe(true)
    expect(origin.state.requests).toEqual([])
    const before = await readFile(second.settingsPath, 'utf8')
    const invalid = { ...manifest, capabilities: manifest.capabilities.filter(item => item.id === 'video.comfyui').map(item => ({ ...item, configuration: { version: 2 } })) }
    await expect(second.ctx.capabilities.restoreManifest(invalid, new AbortController().signal)).resolves.toMatchObject([{ status: 'failed' }])
    expect(await readFile(second.settingsPath, 'utf8')).toBe(before)
  })
  it('keeps disabled composition offline and contributes no targets', async () => {
    const http = await fixture()
    disposers.push(() => http.close())
    const app = await load({ baseURL: http.baseURL })
    expect(app.ctx.videoProduction.generationTargets()).toEqual([])
    expect(http.state.requests).toEqual([])
  })

  it('publishes declared targets and stores the generated project version before removing its registration', async () => {
    const http = await fixture()
    disposers.push(() => http.close())
    const app = await load(http.config())
    const targets = app.ctx.videoProduction.generationTargets()
    expect(targets).toMatchObject([{ generator: 'comfyui', model: 'owned', title: 'Owned workflow', limits: { durations: [2, 4], minReferenceImages: 0, maxReferenceImages: 0 } }])
    expect(targets[0]!.revision).toMatch(/^[a-f0-9]{64}$/)
    const project = await app.ctx.videoProduction.generate(app.sessionId, VideoShotId('shot'), { generator: 'comfyui', model: 'owned' }, new AbortController().signal)
    const version = project.shots[0]!.versions[0]!
    expect(version).toMatchObject({ status: 'completed', generator: 'comfyui', model: 'owned', generatorRevision: targets[0]!.revision })
    expect(await app.ctx.videoProduction.view(app.sessionId)).toEqual(project)
    expect(Buffer.from((await app.ctx.attachments.readVideo(version.attachment!)).data)).toEqual(mp4)
    await app.provider.fiber!.dispose()
    expect(app.ctx.videoProduction.generationTargets()).toEqual([])
  })

  it('awaits active job cancellation when the provider fiber unloads', async () => {
    const polled = Promise.withResolvers<undefined>()
    const http = await fixture((request, response, state) => {
      if (request.url === '/prompt') { state.status = 'in_progress'; return false }
      if (request.url!.startsWith('/history/')) { polled.resolve(undefined); json(response, {}); return true }
      return false
    })
    disposers.push(() => http.close())
    const app = await load(http.config())
    const operation = app.ctx.videoProduction.generate(app.sessionId, VideoShotId('shot'), { generator: 'comfyui', model: 'owned' }, new AbortController().signal)
    void operation.catch(() => {})
    disposers.push(async () => { await app.provider.fiber!.dispose(); await Promise.allSettled([operation]) })
    await polled.promise
    await app.provider.fiber!.dispose()
    const project = await operation
    expect(project.shots[0]!.versions[0]).toMatchObject({ status: 'failed', error: 'The ComfyUI video provider was unloaded.' })
    expect(http.state.cancellations).toEqual([http.state.submissions[0]!.prompt_id])
    expect(app.ctx.videoProduction.generationTargets()).toEqual([])
  })
})
