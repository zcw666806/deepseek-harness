/** Real settings and project-package flows with deterministic fixture providers; no model or process installation. */
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CapabilityId, CapabilityHealth } from '@deepseek-ai/dsh-capability-manager/types'
import type { VideoShotId } from '@deepseek-ai/dsh-video-production/types'
import type {} from '@deepseek-ai/dsh-capability-manager'
import type {} from '@deepseek-ai/dsh-video-production'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-video-comfyui'
import { launchWebScaffold, readPersistedEvents, seedSession, captureStableAria, compareOrRefreshGolden, selectedSessionFixture, webSnapshotMode, watchConsole, type WebScaffold } from './scaffold.ts'
import { browserReference, browserVideo } from './video-fixtures.ts'
import { closeCreationStudio, openCreationStudio, REPO_ROOT, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const SOURCE = SessionId('portability-source')
const CAPABILITY = 'fixture.portability' as CapabilityId
const CAPABILITY_TITLE = '测试能力（无进程）'
const SOURCE_TITLE = '项目迁移源 · 原项目'
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.v4.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/capabilities-managed/fixture.expected.md', import.meta.url))
const WORKFLOW_EXPECTED = fileURLToPath(new URL('./expected/capabilities-managed/workflow.expected.md', import.meta.url))
const MODE = webSnapshotMode()
function poll<Value>(read: () => Value | Promise<Value>) { return expect.poll(read, { timeout: 20000 }) }

async function openProject(page: Page, title: string): Promise<void> {
  const group = page.getByRole('treeitem').first()
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
  await page.getByRole('treeitem').filter({ hasText: title }).last().click()
  await openCreationStudio(page, 'video', 'zh')
  await page.getByLabel('项目名称', { exact: true }).waitFor()
}

describe.skipIf(MODE === 'record')('Web capability management and project-media portability', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let workspace: Workspace
  let consoleWatch: ReturnType<typeof watchConsole>
  let status: CapabilityHealth['status'] = 'missing'
  let configured = 'initial'
  let probe: Server
  let serviceURL: string
  let workflowRequests = 0
  const actions: string[] = []

  beforeAll(async () => {
    probe = createServer((_request, response) => { workflowRequests++; response.writeHead(503); response.end() })
    await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve) })
    const address = probe.address()
    if (address === null || typeof address === 'string') throw new Error('Workflow HTTP probe has no TCP address.')
    serviceURL = `http://127.0.0.1:${address.port}`
    scaffold = await launchWebScaffold({})
    scaffold.ctx.capabilities.register({
      descriptor: { id: CAPABILITY, title: CAPABILITY_TITLE, description: '仅用于验证固定操作与配置恢复。', category: 'test', engineId: 'fixture', kind: 'local' },
      inspect: async () => ({ status, owned: status === 'ready', requirements: [{
        id: 'fixture-runtime', title: '测试运行环境', status: status === 'missing' ? 'missing' : 'available',
      }] }),
      prepare: async () => { actions.push('prepare'); status = 'stopped' },
      start: async () => { actions.push('start'); status = 'ready' },
      stop: async () => { actions.push('stop'); status = 'stopped' },
      exportConfiguration: async () => ({ profile: configured }),
      restoreConfiguration: async (value) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof value.profile !== 'string') throw new Error('Invalid fixture settings')
        configured = value.profile
        actions.push('restore')
      },
    })
    const fixture = (await readFile(await selectedSessionFixture(FIXTURE), 'utf8')).split('{{cwd}}').join(JSON.stringify(scaffold.workspaceCwd).slice(1, -1))
    await seedSession(scaffold, fixture, SOURCE)
    await scaffold.ctx.sessionController.rename({ sessionId: SOURCE, title: SOURCE_TITLE })
    workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, '迁移测试工作区')
    await workspace.attachSession(SOURCE)
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1920, height: 1120 }, locale: ZH_BROWSER_LOCALE, colorScheme: 'dark' })
    consoleWatch = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]')
    const video = await scaffold.ctx.attachments.saveVideo({ data: await browserVideo(page), mediaType: 'video/webm', name: 'migration-test.webm' })
    scaffold.ctx.videoProduction.registerGenerator('fixture-generator', async () => ({ attachment: video, model: 'fixture-video' }))
    const initial = await scaffold.ctx.videoProduction.view(SOURCE)
    const empty = await scaffold.ctx.videoProduction.addAsset(SOURCE, {
      revision: initial.revision, name: '迁移测试参考图', kind: 'character', description: 'Synthetic reference fixture',
      image: { data: (await browserReference(page, 'character')).toString('base64'), mediaType: 'image/png', name: 'migration-reference.png' },
    }, new AbortController().signal)
    const assetId = empty.assets[0]?.id
    if (assetId === undefined) throw new Error('Reference fixture was not admitted to its project.')
    await scaffold.ctx.videoProduction.update(SOURCE, {
      revision: empty.revision, title: '可迁移测试项目',
      assets: empty.assets, shots: [{
        id: 'migration-shot' as VideoShotId, title: '可迁移测试镜头', prompt: 'Synthetic fixture for package restoration.',
        duration: 1, aspectRatio: '16:9', resolution: '480p', assetIds: [assetId], position: { x: 0, y: 0 },
      }],
    })
    await scaffold.ctx.videoProduction.generate(SOURCE, 'migration-shot' as VideoShotId, { generator: 'fixture-generator' }, new AbortController().signal)
  })

  afterAll(async () => {
    try { await browser?.close() } finally {
      try { await scaffold?.close() } finally {
        if (probe?.listening) await new Promise<void>((resolve, reject) => {
          probe.close((error) => { if (error) reject(error); else resolve() })
        })
      }
    }
  })

  afterEach(async () => {
    if (page === undefined) return
    const dialog = page.getByRole('dialog', { name: '设置' })
    if (await dialog.count() > 0) await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  })

  it('configures diagnostic workflows through settings without contacting or starting an engine or adding a model turn', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-workflow-configuration'))
    const history = await readPersistedEvents(scaffold, SOURCE)
    const signal = new AbortController().signal
    const engine = await scaffold.ctx.capabilities.perform('engine.comfyui' as CapabilityId, 'check', signal)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '视频工作流', exact: true }).click()
    await dialog.getByRole('button', { name: '添加黑帧传输诊断（非 AI 生成）', exact: true }).click()
    await dialog.getByLabel('服务地址（HTTP 或 HTTPS，不含凭据、查询参数或片段）', { exact: true }).fill(serviceURL)
    await dialog.getByLabel('目标名称', { exact: true }).fill('黑帧传输诊断（非 AI）')
    await dialog.getByLabel('支持的时长（秒数数组）', { exact: true }).fill('[1,2]')
    expect(await dialog.getByRole('button', { name: '启用工作流', exact: true }).isDisabled()).toBe(true)
    await dialog.getByRole('button', { name: '校验工作流', exact: true }).click()
    await dialog.getByText('配置校验通过；引擎与模型就绪情况需另行检查。', { exact: true }).waitFor()
    expect((await scaffold.ctx.videoWorkflows.view()).configuration.workflows).toEqual([])
    expect(workflowRequests).toBe(0)
    await dialog.getByRole('button', { name: '保存并禁用', exact: true }).click()
    await poll(async () => (await scaffold.ctx.videoWorkflows.view()).configuration.workflows[0]?.durations).toEqual([1, 2])
    expect((await scaffold.ctx.videoWorkflows.view()).enabled).toBe(false)
    await dialog.getByText('工作流已禁用', { exact: true }).waitFor()
    await dialog.getByRole('button', { name: '启用工作流', exact: true }).click()
    await dialog.getByText('工作流已启用', { exact: true }).waitFor()
    expect((await scaffold.ctx.videoWorkflows.view()).enabled).toBe(true)
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]')
    await page.getByRole('button', { name: '设置', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '视频工作流', exact: true }).click()
    await dialog.getByText('工作流已启用', { exact: true }).waitFor()
    expect(await dialog.getByLabel('目标名称', { exact: true }).inputValue()).toBe('黑帧传输诊断（非 AI）')
    expect(await dialog.getByLabel('支持的时长（秒数数组）', { exact: true }).inputValue()).toBe('[1,2]')
    expect(await dialog.getByLabel('服务地址（HTTP 或 HTTPS，不含凭据、查询参数或片段）', { exact: true }).inputValue()).toBe(serviceURL)
    expect(workflowRequests).toBe(0)
    const afterEngine = await scaffold.ctx.capabilities.perform('engine.comfyui' as CapabilityId, 'check', signal)
    expect({ status: afterEngine.status, owned: afterEngine.owned }).toEqual({ status: engine.status, owned: engine.owned })
    expect(actions).toEqual([])
    expect(await readPersistedEvents(scaffold, SOURCE)).toEqual(history)
    const aria = await captureStableAria(page, 'section[aria-label="视频工作流"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(WORKFLOW_EXPECTED, aria.split(serviceURL).join('http://127.0.0.1:{{port}}'), MODE)
    await mkdir(join(REPO_ROOT, '.playwright-mcp'), { recursive: true })
    await page.screenshot({ path: join(REPO_ROOT, '.playwright-mcp/workflow-configuration.png'), fullPage: true })
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    expect(consoleWatch.pageErrors).toEqual([])
  })

  it('manages fixed capabilities and restores project media without automatic engine execution or overwriting the source', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-capabilities-managed'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '能力管理', exact: true }).click()
    const card = dialog.getByRole('article', { name: CAPABILITY_TITLE })
    await card.getByText('缺少依赖', { exact: true }).waitFor()
    await card.getByRole('button', { name: '准备', exact: true }).click()
    await card.getByText('已停止', { exact: true }).waitFor()
    await card.getByRole('button', { name: '启动', exact: true }).click()
    await card.getByText('由 DSH 托管', { exact: true }).waitFor()
    await card.getByRole('button', { name: '停止', exact: true }).click()
    await card.getByText('已停止', { exact: true }).waitFor()
    expect(actions).toEqual(['prepare', 'start', 'stop'])
    await compareOrRefreshGolden(EXPECTED, await captureStableAria(page, `article[aria-label="${CAPABILITY_TITLE}"]`, scaffold.workspaceCwd), MODE)
    await dialog.getByRole('button', { name: '导出能力配置', exact: true }).click()
    const [settingsDownload] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('link', { name: '下载能力配置', exact: true }).click()])
    const settingsPath = await settingsDownload.path()
    if (settingsPath === null) throw new Error('Capability settings were not downloaded.')
    configured = 'changed'
    await dialog.getByLabel('选择能力配置文件', { exact: true }).setInputFiles(settingsPath)
    await dialog.getByRole('region', { name: '恢复预览', exact: true }).waitFor()
    expect(configured).toBe('changed')
    expect(actions).toEqual(['prepare', 'start', 'stop'])
    await dialog.getByRole('button', { name: '应用配置', exact: true }).click()
    await poll(() => configured).toBe('initial')
    await dialog.getByRole('list', { name: '配置恢复结果' }).waitFor()
    await poll(() => dialog.getByRole('button', { name: '刷新状态', exact: true }).isEnabled()).toBe(true)
    expect(actions).toEqual(['prepare', 'start', 'stop', 'restore'])
    await mkdir(join(REPO_ROOT, '.playwright-mcp'), { recursive: true })
    await page.screenshot({ path: join(REPO_ROOT, '.playwright-mcp/capabilities-managed.png'), fullPage: true })
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    const source = await scaffold.ctx.videoProduction.view(SOURCE)
    await openProject(page, SOURCE_TITLE)
    expect(await page.getByRole('button', { name: '恢复项目与素材', exact: true }).isDisabled()).toBe(true)
    await page.getByRole('button', { name: '导出项目包', exact: true }).click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: '下载项目包', exact: true }).click()])
    const path = await download.path()
    if (path === null) throw new Error('The project package was not downloaded.')
    expect(download.suggestedFilename()).toBe('project.dshvideo')
    await copyFile(path, join(REPO_ROOT, '.playwright-mcp/video-project-recovery-sample.dshvideo'))
    await closeCreationStudio(page, 'video', 'zh')
    await page.getByRole('button', { name: '新建会话', exact: true }).filter({ hasText: '新会话' }).click()
    await poll(() => workspace.sessionIds.some(id => id !== SOURCE)).toBe(true)
    const target = workspace.sessionIds.find(id => id !== SOURCE)
    if (target === undefined) throw new Error('The New Session action did not create a target.')
    await openCreationStudio(page, 'video', 'zh')
    expect((await scaffold.ctx.videoProduction.view(target)).revision).toBe(0)
    const targetEvents = await readPersistedEvents(scaffold, target)
    expect(targetEvents.some(event => event.type === 'turn/start')).toBe(false)
    await poll(() => page.getByRole('button', { name: '恢复项目与素材', exact: true }).isEnabled()).toBe(true)
    await page.getByLabel('选择项目包', { exact: true }).setInputFiles(path)
    await poll(async () => (await scaffold.ctx.videoProduction.view(target)).shots.length).toBe(1)
    const restored = await scaffold.ctx.videoProduction.view(target)
    expect(restored.title).toBe(source.title)
    expect(restored.sessionId).toBe(target)
    const sourceImage = source.assets[0]?.image
    const restoredImage = restored.assets[0]?.image
    if (sourceImage === undefined || restoredImage === undefined) throw new Error('Restoration lost reference media.')
    const originalImageBytes = (await scaffold.ctx.attachments.readImage(sourceImage)).data
    expect((await scaffold.ctx.attachments.readImage(restoredImage)).data).toEqual(originalImageBytes)
    expect(restored.shots[0]?.versions[0]?.referenceImages).toEqual([restoredImage])
    expect(restored.shots[0]?.selectedVersionId).toBe(source.shots[0]?.selectedVersionId)
    const originalVideo = source.shots[0]?.versions[0]?.attachment
    const restoredVideo = restored.shots[0]?.versions[0]?.attachment
    if (originalVideo === undefined || restoredVideo === undefined) throw new Error('Restoration lost generated media.')
    const originalVideoBytes = (await scaffold.ctx.attachments.readVideo(originalVideo)).data
    expect((await scaffold.ctx.attachments.readVideo(restoredVideo)).data).toEqual(originalVideoBytes)
    expect(await scaffold.ctx.videoProduction.view(SOURCE)).toEqual(source)
    expect(actions).toEqual(['prepare', 'start', 'stop', 'restore'])
    configured = 'changed-again'
    await page.getByRole('button', { name: '恢复能力配置', exact: true }).click()
    await poll(() => configured).toBe('initial')
    expect(actions).toEqual(['prepare', 'start', 'stop', 'restore', 'restore'])
    await page.getByRole('list', { name: '能力配置恢复结果' }).waitFor()
    await page.getByRole('button', { name: '适应画布', exact: true }).click()
    await page.getByRole('button', { name: '加载视频', exact: true }).click()
    await page.locator('[data-workflow-kind="video-result"] video').waitFor()
    await page.screenshot({ path: join(REPO_ROOT, '.playwright-mcp/video-project-restored.png'), fullPage: true })
    const targetHistory = await readPersistedEvents(scaffold, target)
    expect(targetHistory.some(event => event.type === 'turn/start' || event.type === 'user/message')).toBe(false)
    const sessionCount = workspace.sessionIds.length
    await closeCreationStudio(page, 'video', 'zh')
    await page.getByRole('button', { name: '新建会话', exact: true }).filter({ hasText: '新会话' }).click()
    await poll(() => workspace.sessionIds.length).toBe(sessionCount + 1)
    const fresh = workspace.sessionIds.find(id => id !== SOURCE && id !== target)
    if (fresh === undefined) throw new Error('New Session reused a project-bearing Session.')
    expect((await scaffold.ctx.videoProduction.view(fresh)).revision).toBe(0)
    expect(await scaffold.ctx.videoProduction.view(target)).toEqual(restored)
    const freshHistory = await readPersistedEvents(scaffold, fresh)
    expect(freshHistory.some(event => event.type === 'turn/start' || event.type === 'user/message')).toBe(false)
    const sidebar = page.getByRole('tree')
    await sidebar.getByText(restored.title, { exact: true }).waitFor()
    expect(await sidebar.getByText(SOURCE_TITLE, { exact: true }).count()).toBe(1)
    await page.getByRole('button', { name: '搜索会话', exact: true }).click()
    await page.getByPlaceholder('搜索会话…', { exact: true }).fill(restored.title)
    await page.getByRole('treeitem').filter({ hasText: restored.title }).last().click()
    await openCreationStudio(page, 'video', 'zh')
    await poll(() => page.getByLabel('项目名称', { exact: true }).inputValue()).toBe(restored.title)
    await closeCreationStudio(page, 'video', 'zh')
    await page.getByRole('button', { name: '清除搜索', exact: true }).click()
    await page.reload({ waitUntil: 'load' })
    const group = page.getByRole('treeitem').first()
    await group.waitFor()
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    await page.getByRole('tree').getByText(restored.title, { exact: true }).waitFor()
    expect(await page.getByRole('tree').getByText(SOURCE_TITLE, { exact: true }).count()).toBe(1)
    await page.getByRole('tree').getByText(restored.title, { exact: true }).click()
    await openCreationStudio(page, 'video', 'zh')
    await poll(() => page.getByLabel('项目名称', { exact: true }).inputValue()).toBe(restored.title)
    await page.getByRole('button', { name: '适应画布', exact: true }).click()
    await page.getByRole('button', { name: '加载视频', exact: true }).click()
    await page.locator('[data-workflow-kind="video-result"] video').waitFor()
    await page.screenshot({ path: join(REPO_ROOT, '.playwright-mcp/video-project-restored.png'), fullPage: true })
    const finalTargetHistory = await readPersistedEvents(scaffold, target)
    expect(finalTargetHistory.some(event => event.type === 'turn/start' || event.type === 'user/message')).toBe(false)
    expect(await scaffold.ctx.videoProduction.view(SOURCE)).toEqual(source)
    expect(consoleWatch.pageErrors).toEqual([])
  })
})
