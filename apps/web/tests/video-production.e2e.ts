// Shipped Web composition with a deterministic video provider; no model API calls.
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { VideoGenerationInput } from '@deepseek-ai/dsh-video-production/types'
import type {} from '@deepseek-ai/dsh-video-production'
import { launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { browserReference, browserVideo } from './video-fixtures.ts'
import { REPO_ROOT, ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.jsonl', import.meta.url))
const SESSION = SessionId('video-production-web-e2e')
const FIRST = '01 · 相遇（测试镜头）'
const SECOND = '02 · 远行（测试镜头）'

async function settleCanvas(page: Page): Promise<void> {
  await page.locator('.react-flow__viewport').evaluate(async (element) => {
    const deadline = performance.now() + 5000
    let previous = getComputedStyle(element).transform
    let stable = 0
    while (stable < 6) {
      await new Promise<number>((resolve) => { requestAnimationFrame(resolve) })
      const current = getComputedStyle(element).transform
      stable = current === previous ? stable + 1 : 0
      previous = current
      if (performance.now() > deadline) throw new Error('The workflow viewport did not settle.')
    }
  })
}

async function fitCanvas(page: Page): Promise<void> {
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  await settleCanvas(page)
}

async function connectPorts(page: Page, source: string, target: string, output: string, input: string): Promise<void> {
  await fitCanvas(page)
  await page.locator('[data-workflow-node-id]').filter({ has: page.locator(`[data-handleid=${JSON.stringify(output)}]`) })
    .filter({ hasText: source }).locator(`[data-handleid=${JSON.stringify(output)}]`).click()
  await page.locator('[data-workflow-node-id]').filter({ has: page.locator(`[data-handleid=${JSON.stringify(input)}]`) })
    .filter({ hasText: target }).locator(`[data-handleid=${JSON.stringify(input)}]`).click()
}

/** Click the actual SVG connection stroke, rather than changing graph state from the test. */
async function selectConnection(page: Page, id: string): Promise<void> {
  const path = page.locator(`.react-flow__edge[data-id=${JSON.stringify(id)}] .react-flow__edge-interaction`)
  const point = await path.evaluate((element, expectedId) => {
    const curve = element as SVGPathElement
    const matrix = curve.getScreenCTM()
    if (matrix === null) throw new Error('Connection has no screen transform.')
    for (const fraction of [0.5, 0.25, 0.75, 0.15, 0.85, 0.35, 0.65]) {
      const value = curve.getPointAtLength(curve.getTotalLength() * fraction)
      const screen = { x: matrix.a * value.x + matrix.c * value.y + matrix.e, y: matrix.b * value.x + matrix.d * value.y + matrix.f }
      if (document.elementFromPoint(screen.x, screen.y)?.closest('.react-flow__edge')?.getAttribute('data-id') === expectedId) return screen
    }
    throw new Error('The connection has no unobstructed interactive stroke.')
  }, id)
  await page.mouse.click(point.x, point.y)
  await poll(() => page.locator(`.react-flow__edge[data-id=${JSON.stringify(id)}]`).getAttribute('class')).toContain('selected')
}

function poll<Value>(read: () => Value | Promise<Value>) {
  return expect.poll(read, { timeout: 15_000 })
}

describe.skipIf(webSnapshotMode() === 'record')('web e2e: video production workspace', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let clip: VideoAttachmentRef
  let clipBytes: Buffer
  const requests: VideoGenerationInput[] = []
  const gates: ReturnType<typeof generationGate>[] = []
  const ownedGates: ReturnType<typeof generationGate>[] = []

  function generationGate() {
    const entered = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    return { entered, released }
  }

  function holdNextGeneration() {
    const gate = generationGate()
    gates.push(gate)
    ownedGates.push(gate)
    return gate
  }

  async function openProduction(): Promise<void> {
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const group = page.getByRole('treeitem').first()
    await group.waitFor({ timeout: 15_000 })
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    const session = page.getByRole('treeitem').nth(1)
    await session.waitFor({ timeout: 10_000 })
    await session.click()
    await page.getByRole('tab', { name: '视频制作', exact: true }).click()
    await page.getByLabel('项目名称', { exact: true }).waitFor({ timeout: 15_000 })
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const fixture = (await readFile(FIXTURE, 'utf8'))
      .split('{{cwd}}').join(JSON.stringify(scaffold.workspaceCwd).slice(1, -1))
    await seedSession(scaffold, fixture, SESSION)
    await scaffold.ctx.sessionController.rename({ sessionId: SESSION, title: '视频节点工作流 · 测试素材' })
    browser = await chromium.launch()
    const context = await browser.newContext({ viewport: { width: 1920, height: 1120 }, locale: ZH_BROWSER_LOCALE, colorScheme: 'dark' })
    page = await context.newPage()
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    clipBytes = await browserVideo(page)
    clip = await scaffold.ctx.attachments.saveVideo({
      data: clipBytes, mediaType: 'video/webm', name: 'workspace-test-clip.webm',
      durationSeconds: 1, width: 640, height: 360,
    })
    scaffold.ctx.videoProduction.registerGenerator('browser-fixture', async (request, signal) => {
      signal.throwIfAborted()
      requests.push(request)
      const gate = gates.shift()
      if (gate !== undefined) {
        gate.entered.resolve(undefined)
        const aborted = Promise.withResolvers<undefined>()
        const abort = (): void => { aborted.reject(new Error('Fixture generation aborted.')) }
        signal.addEventListener('abort', abort, { once: true })
        try {
          signal.throwIfAborted()
          await Promise.race([gate.released.promise, aborted.promise])
        } finally {
          signal.removeEventListener('abort', abort)
        }
      }
      return { attachment: clip, model: request.model ?? 'browser-fixture' }
    }, () => [
      { title: '浏览器测试目标 A', model: 'fixture-a' },
      { title: '浏览器测试目标 B', model: 'fixture-b' },
    ])
    const group = page.getByRole('treeitem').first()
    await group.waitFor({ timeout: 15_000 })
    await group.click()
    const session = page.getByRole('treeitem').nth(1)
    await session.waitFor({ timeout: 10_000 })
    await session.click()
    await page.getByRole('tab', { name: '视频制作', exact: true }).click()
    await page.getByLabel('项目名称', { exact: true }).waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    for (const gate of ownedGates) gate.released.resolve(undefined)
    await browser?.close()
    await scaffold?.close()
  })

  it('persists editable shots and references, reorders the sequence, and previews and downloads generated media', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-video-production'))
    await page.getByLabel('项目名称', { exact: true }).fill('视频生产验证 · 测试素材')
    await page.getByRole('button', { name: '添加分镜', exact: true }).click()
    await fitCanvas(page)
    await page.getByLabel('镜头标题', { exact: true }).nth(0).fill(FIRST)
    await page.getByLabel('画面描述', { exact: true }).nth(0).fill('测试镜头：角色在路边相遇，固定机位。')
    await page.getByRole('button', { name: '添加分镜', exact: true }).click()
    await fitCanvas(page)
    await page.getByLabel('镜头标题', { exact: true }).nth(1).fill(SECOND)
    await page.getByLabel('画面描述', { exact: true }).nth(1).fill('测试镜头：角色走向远处，保留原有场景。')
    await page.getByRole('button', { name: '保存分镜', exact: true }).click()
    await poll(async () => (await scaffold.ctx.videoProduction.view(SESSION)).shots.map(shot => shot.title))
      .toEqual([FIRST, SECOND])
    await poll(() => page.getByRole('button', { name: '保存分镜', exact: true }).isDisabled()).toBe(true)

    await page.getByRole('button', { name: '向前移动镜头', exact: true }).nth(1).click()
    await poll(async () => (await scaffold.ctx.videoProduction.view(SESSION)).shots.map(shot => shot.title))
      .toEqual([SECOND, FIRST])
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('tab', { name: '视频制作', exact: true }).click()
    await fitCanvas(page)
    await poll(() => page.getByLabel('镜头标题', { exact: true }).nth(0).inputValue()).toBe(SECOND)
    expect(await page.getByLabel('镜头标题', { exact: true }).nth(1).inputValue()).toBe(FIRST)

    const library = page.getByRole('button', { name: '素材库', exact: true })
    if (await library.getAttribute('aria-expanded') !== 'true') await library.click()
    await page.getByLabel('素材名称', { exact: true }).fill('测试角色参考')
    await page.getByLabel('选择图片', { exact: true }).setInputFiles({ name: 'character-test.png', mimeType: 'image/png', buffer: await browserReference(page, 'character') })
    await poll(async () => (await scaffold.ctx.videoProduction.view(SESSION)).assets.length).toBe(1)
    await poll(() => page.getByRole('button', { name: '添加参考图', exact: true }).isEnabled()).toBe(true)
    await page.getByLabel('素材名称', { exact: true }).fill('测试场景参考')
    await page.getByLabel('素材类型').selectOption('scene')
    await page.getByLabel('选择图片', { exact: true }).setInputFiles({ name: 'scene-test.png', mimeType: 'image/png', buffer: await browserReference(page, 'scene') })
    await poll(async () => (await scaffold.ctx.videoProduction.view(SESSION)).assets.length).toBe(2)
    await poll(() => page.getByRole('button', { name: '添加参考图', exact: true }).isEnabled()).toBe(true)
    await connectPorts(page, '测试场景参考', SECOND, 'image', 'references')
    await connectPorts(page, '测试角色参考', SECOND, 'image', 'references')
    await page.getByRole('button', { name: '保存分镜', exact: true }).click()
    await poll(async () => (await scaffold.ctx.videoProduction.view(SESSION)).shots[0]?.assetIds.length).toBe(2)
    await poll(() => page.getByRole('button', { name: '保存分镜', exact: true }).isDisabled()).toBe(true)

    expect(await page.getByRole('button', { name: '生成镜头', exact: true }).nth(0).isDisabled()).toBe(true)
    await page.getByLabel('本次生成目标', { exact: true }).selectOption({ label: '浏览器测试目标 B · fixture-b' })
    expect(await page.getByRole('button', { name: '保存分镜', exact: true }).isDisabled()).toBe(true)
    await page.getByRole('button', { name: '生成镜头', exact: true }).nth(0).click()
    await poll(() => page.getByRole('button', { name: '重新生成', exact: true }).count()).toBe(1)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.model).toBe('fixture-b')
    const saved = await scaffold.ctx.videoProduction.view(SESSION)
    expect(requests[0]?.referenceImages).toEqual([saved.assets[1]?.image, saved.assets[0]?.image])
    await page.getByRole('button', { name: '加载视频', exact: true }).click()
    const preview = page.locator('[data-workflow-kind="video-result"]').getByLabel(`预览镜头 ${SECOND}`, { exact: true })
    await preview.waitFor()
    await poll(() => preview.evaluate(video => ({
      hasFrame: (video as HTMLVideoElement).readyState >= 2,
      width: (video as HTMLVideoElement).videoWidth,
    }))).toEqual({ hasFrame: true, width: 640 })
    expect(await preview.getAttribute('src')).toMatch(/^blob:/)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: '下载镜头', exact: true }).click(),
    ])
    const downloaded = await download.path()
    if (downloaded === null) throw new Error('The generated test clip did not download.')
    expect(await readFile(downloaded)).toEqual(clipBytes)

    const background = holdNextGeneration()
    await page.getByRole('button', { name: '生成缺失镜头', exact: true }).click()
    await background.entered.promise
    const admitted = await scaffold.ctx.videoProduction.batch(SESSION)
    expect(admitted?.status).toBe('running')
    expect(admitted?.shots.map(shot => shot.status)).toEqual(['running'])
    expect(tripwire.pageErrors).toEqual([])
    const context = page.context()
    await page.close()
    background.released.resolve(undefined)
    await poll(async () => (await scaffold.ctx.videoProduction.batch(SESSION))?.status).toBe('completed')
    page = await context.newPage()
    tripwire = watchConsole(page)
    await openProduction()
    await page.getByRole('region', { name: '后台制作批次', exact: true }).getByText('批次已完成', { exact: true }).waitFor()
    expect((await scaffold.ctx.videoProduction.batch(SESSION))?.id).toBe(admitted?.id)
    await poll(async () => {
      const project = await scaffold.ctx.videoProduction.view(SESSION)
      return project.shots.every(shot => shot.versions.some(version => version.status === 'completed'))
    }).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests.map(request => request.model)).toEqual(['fixture-b', 'fixture-b'])
    await poll(() => page.getByRole('button', { name: '合成导出', exact: true }).isEnabled()).toBe(true)
    const completed = await scaffold.ctx.videoProduction.view(SESSION)
    const secondShot = completed.shots[0]!
    const resultId = `video-result:${encodeURIComponent(secondShot.id)}:${encodeURIComponent(secondShot.selectedVersionId!)}`
    const assemblyId = `assembly:${encodeURIComponent(completed.id)}`
    await fitCanvas(page)
    await selectConnection(page, JSON.stringify([resultId, 'video', assemblyId, 'clips']))
    await page.keyboard.press('Delete')
    await page.getByRole('button', { name: '保存分镜', exact: true }).click()
    await poll(async () => (await scaffold.ctx.videoProduction.view(SESSION)).shots[0]?.selectedVersionId).toBeUndefined()
    await poll(() => page.getByRole('button', { name: '合成导出', exact: true }).isDisabled()).toBe(true)
    await connectPorts(page, SECOND, '成片编排', 'video', 'clips')
    await page.getByRole('button', { name: '保存分镜', exact: true }).click()
    await poll(async () => (await scaffold.ctx.videoProduction.view(SESSION)).shots[0]?.selectedVersionId)
      .toBe(secondShot.selectedVersionId)
    await poll(() => page.getByRole('button', { name: '合成导出', exact: true }).isEnabled()).toBe(true)

    const beforeCleanup = await scaffold.ctx.videoProduction.view(SESSION)
    for (const title of ['临时分镜 A', '临时分镜 B']) {
      await page.getByRole('button', { name: '添加分镜', exact: true }).click()
      await fitCanvas(page)
      await page.getByLabel('镜头标题', { exact: true }).last().fill(title)
      await page.getByLabel('画面描述', { exact: true }).last().fill('仅用于验证多选删除，不提交视频生成。')
    }
    await poll(() => page.getByLabel('镜头标题', { exact: true }).count()).toBe(4)
    const temporaryA = page.locator('[data-workflow-kind="prompt"]').filter({ hasText: '临时分镜 A' })
    const temporaryB = page.locator('[data-workflow-kind="prompt"]').filter({ hasText: '临时分镜 B' })
    await temporaryA.locator('header').click()
    await temporaryB.locator('header').click({ modifiers: ['ControlOrMeta'] })
    await poll(() => page.locator('.react-flow__node.selected').filter({
      has: page.locator('[data-workflow-kind="prompt"]'),
    }).count()).toBe(2)
    await page.keyboard.press('Delete')
    await poll(() => page.getByLabel('镜头标题', { exact: true }).count()).toBe(2)
    await page.getByRole('button', { name: '保存分镜', exact: true }).click()
    await poll(async () => (await scaffold.ctx.videoProduction.view(SESSION)).revision).toBeGreaterThan(beforeCleanup.revision)
    expect((await scaffold.ctx.videoProduction.view(SESSION)).shots.map(shot => shot.id)).toEqual(beforeCleanup.shots.map(shot => shot.id))

    await page.getByRole('button', { name: '自动排列', exact: true }).click()
    await fitCanvas(page)
    const viewport = () => page.locator('.react-flow__viewport').evaluate((element) => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform)
      return { x: matrix.e, y: matrix.f, zoom: matrix.a }
    })
    const fitted = await viewport()
    await page.getByRole('button', { name: '缩小画布', exact: true }).click()
    await poll(async () => (await viewport()).zoom).toBeLessThan(fitted.zoom)
    const pane = await page.locator('.react-flow__pane').boundingBox()
    if (pane === null) throw new Error('The workflow canvas pane is unavailable.')
    const beforePan = await viewport()
    await page.mouse.move(pane.x + 220, pane.y + pane.height - 70)
    await page.mouse.down({ button: 'middle' })
    try {
      await page.mouse.move(pane.x + 280, pane.y + pane.height - 40, { steps: 8 })
    } finally {
      await page.mouse.up({ button: 'middle' })
    }
    await poll(async () => Math.abs((await viewport()).x - beforePan.x)).toBeGreaterThan(20)
    await page.locator('.react-flow__pane').click({ position: { x: 16, y: 16 } })
    const currentLibrary = page.getByRole('button', { name: '素材库', exact: true })
    if (await currentLibrary.getAttribute('aria-expanded') === 'true') await currentLibrary.click()
    await poll(() => page.getByRole('heading', { name: '节点检查器', exact: true }).count()).toBe(0)
    await fitCanvas(page)
    expect(requests).toHaveLength(2)
    expect(tripwire.pageErrors).toEqual([])

    const evidenceDirectory = join(REPO_ROOT, '.playwright-mcp')
    await mkdir(evidenceDirectory, { recursive: true })
    const screenshotPath = join(evidenceDirectory, 'video-production-workflow-canvas.png')
    await page.screenshot({ path: screenshotPath, fullPage: true })
    console.info(`Video workspace UI evidence (synthetic test clips): ${screenshotPath}`)
    await page.getByRole('textbox', { name: '搜索节点…', exact: true }).fill(`视频生成 ${SECOND}`)
    await settleCanvas(page)
    await page.getByRole('heading', { name: '节点检查器', exact: true }).waitFor()
    await poll(() => page.locator('.react-flow__node.selected [data-workflow-kind="generation"]')
      .filter({ hasText: SECOND }).count()).toBe(1)
    expect(await page.getByLabel('时长（秒）', { exact: true }).inputValue()).toBe('6')
    const inspectorPath = join(evidenceDirectory, 'video-production-workflow-inspector.png')
    await page.screenshot({ path: inspectorPath, fullPage: true })
    console.info(`Video generation inspector evidence (synthetic test clips): ${inspectorPath}`)
    expect(requests).toHaveLength(2)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('pauses and cancels only after the current Host-owned shot, preserving unsubmitted checkpoints', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-video-background-batch'))
    await page.getByRole('textbox', { name: '搜索节点…', exact: true }).fill('')
    const before = await scaffold.ctx.videoProduction.view(SESSION)
    const requestCount = requests.length
    for (const title of ['后台镜头 A', '后台镜头 B', '后台镜头 C']) {
      await page.getByRole('button', { name: '添加分镜', exact: true }).click()
      await fitCanvas(page)
      await page.getByLabel('镜头标题', { exact: true }).last().fill(title)
      await page.getByLabel('画面描述', { exact: true }).last().fill(`测试素材：${title}，验证后台批次控制。`)
    }
    await page.getByRole('button', { name: '保存分镜', exact: true }).click()
    await poll(async () => (await scaffold.ctx.videoProduction.view(SESSION)).shots.length).toBe(before.shots.length + 3)
    await poll(() => page.getByRole('button', { name: '保存分镜', exact: true }).isDisabled()).toBe(true)
    await page.getByLabel('本次生成目标', { exact: true }).selectOption({ label: '浏览器测试目标 B · fixture-b' })
    const first = holdNextGeneration()
    const second = holdNextGeneration()
    await page.getByRole('button', { name: '生成缺失镜头', exact: true }).click()
    await first.entered.promise
    await page.getByRole('button', { name: '当前镜头完成后暂停', exact: true }).click()
    await poll(async () => (await scaffold.ctx.videoProduction.batch(SESSION))?.status).toBe('pausing')
    await page.getByText('等待当前镜头结束后暂停', { exact: true }).waitFor()
    expect(requests).toHaveLength(requestCount + 1)
    first.released.resolve(undefined)
    await poll(async () => (await scaffold.ctx.videoProduction.batch(SESSION))?.status).toBe('paused')
    await page.getByText('已暂停', { exact: true }).waitFor()
    expect((await scaffold.ctx.videoProduction.batch(SESSION))?.shots.map(shot => shot.status)).toEqual(['completed', 'pending', 'pending'])
    expect(requests).toHaveLength(requestCount + 1)

    const evidenceDirectory = join(REPO_ROOT, '.playwright-mcp')
    await mkdir(evidenceDirectory, { recursive: true })
    const screenshotPath = join(evidenceDirectory, 'video-background-batch.png')
    await page.screenshot({ path: screenshotPath, fullPage: true })
    console.info(`Host-owned batch evidence (deterministic synthetic clips): ${screenshotPath}`)

    await page.getByRole('button', { name: '继续未提交镜头', exact: true }).click()
    await second.entered.promise
    await page.getByRole('button', { name: '取消后续镜头', exact: true }).click()
    await poll(async () => (await scaffold.ctx.videoProduction.batch(SESSION))?.status).toBe('cancelling')
    await page.getByText('等待当前镜头结束后取消后续制作', { exact: true }).waitFor()
    second.released.resolve(undefined)
    await poll(async () => (await scaffold.ctx.videoProduction.batch(SESSION))?.status).toBe('cancelled')
    await page.getByText('后续制作已取消', { exact: true }).waitFor()
    const cancelled = await scaffold.ctx.videoProduction.batch(SESSION)
    expect(cancelled?.shots.map(shot => shot.status)).toEqual(['completed', 'completed', 'pending'])
    expect(requests).toHaveLength(requestCount + 2)
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('tab', { name: '视频制作', exact: true }).click()
    await page.getByText('后续制作已取消', { exact: true }).waitFor()
    expect((await scaffold.ctx.videoProduction.batch(SESSION))?.id).toBe(cancelled?.id)
    expect(requests).toHaveLength(requestCount + 2)
    expect(tripwire.pageErrors).toEqual([])
  })
})
