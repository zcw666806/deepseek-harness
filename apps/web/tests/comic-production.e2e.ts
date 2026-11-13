/** Web manuscript edits and byte-preserving PNG exchange through the shipped opt-in overlay. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ComicProjectPackage } from '@deepseek-ai/dsh-comic-production/types'
import { launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.jsonl', import.meta.url))
const SOURCE_WORKSPACE = 'Comic source workspace'
const RESTORED_WORKSPACE = 'Comic handoff workspace'
const SOURCE_SESSION = 'Comic manuscript source'
const REOPEN_SESSION = 'Comic manuscript continuation'
const RESTORE_SESSION = 'Comic manuscript handoff'
const PROJECT_TITLE = 'The borrowed key'
const PANEL_NOTES = 'Keep the key in the reader’s line of sight.'
const DIALOGUE = '先把钥匙交给她。'

async function uploadImage(page: Page, color: string): Promise<Buffer> {
  const data = await page.evaluate((fill) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 96
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('The PNG fixture has no Canvas 2D context.')
    context.fillStyle = fill
    context.fillRect(8, 12, 48, 72)
    return canvas.toDataURL('image/png').split(',')[1]!
  }, color)
  return Buffer.from(data, 'base64')
}

async function downloadedBytes(page: Page, button: Locator): Promise<Buffer> {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  const path = await download.path()
  if (path === null) throw new Error('The comic file did not download.')
  return await readFile(path)
}

async function countRenderedArtworkPixels(page: Page, png: Buffer): Promise<number> {
  return await page.evaluate(async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('The downloaded page has no Canvas 2D context.')
    context.drawImage(image, 0, 0)
    const { data: pixels } = context.getImageData(0, 0, canvas.width, canvas.height)
    let count = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] === 0x27 && pixels[index + 1] === 0x5b && pixels[index + 2] === 0x82) count++
    }
    return count
  }, png.toString('base64'))
}

function button(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true })
}

function label(page: Page, name: string): Locator {
  return page.getByLabel(name)
}

function pageButton(page: Page, index: number): Locator {
  return page.getByRole('navigation', { name: 'Pages', exact: true })
    .getByRole('button', { name: new RegExp(`^Page ${index}(?:\\s|$)`, 'u') })
}

function adoptedVersion(page: Page): Locator {
  return page.getByRole('combobox', { name: /^Adopted version/u })
}

function poll<Value>(read: () => Value | Promise<Value>) {
  return expect.poll(read, { timeout: 15_000 })
}

function saved(page: Page): Promise<void> {
  return page.getByRole('status').filter({ hasText: /^Saved$/u }).waitFor()
}

async function openStudio(page: Page, workspace: string, session: string): Promise<void> {
  const group = page.getByRole('treeitem').filter({ hasText: workspace }).first()
  await group.waitFor()
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
  await page.getByRole('treeitem').filter({ hasText: session }).last().click()
  await page.getByRole('tab', { name: 'Comic studio', exact: true }).click()
}

describe.skipIf(webSnapshotMode() === 'record')('web e2e: comic production workspace', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleWatch: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: join(REPO_ROOT, 'packages/bundle/web-app/comic-production.patch.yml'),
    })
    const importedCwd = join(scaffold.workspaceCwd, 'comic-handoff')
    await mkdir(importedCwd)
    const sourceWorkspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, SOURCE_WORKSPACE)
    const restoredWorkspace = await scaffold.ctx.workspaceRegistry.create(importedCwd, RESTORED_WORKSPACE)
    const fixture = await readFile(FIXTURE, 'utf8')
    for (const [sessionId, title, workspace] of [
      [SessionId('comic-source'), SOURCE_SESSION, sourceWorkspace],
      [SessionId('comic-reopen'), REOPEN_SESSION, sourceWorkspace],
      [SessionId('comic-handoff'), RESTORE_SESSION, restoredWorkspace],
    ] as const) {
      const cwd = workspace.path
      const seeded = fixture.replaceAll('{{cwd}}', JSON.stringify(cwd).slice(1, -1))
      await seedSession({ ...scaffold, workspaceCwd: cwd }, seeded, sessionId)
      await scaffold.ctx.sessionController.rename({ sessionId, title })
      await workspace.attachSession(sessionId)
    }
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 1100)
    page.setDefaultTimeout(15_000)
    consoleWatch = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  })

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it('retains lettering and original layer revisions when reopening and handing off a comic', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-comic-production'))
    await openStudio(page, SOURCE_WORKSPACE, SOURCE_SESSION)
    await label(page, 'Project title').fill(PROJECT_TITLE)
    await button(page, 'Create comic').click()
    await pageButton(page, 3).waitFor()
    await pageButton(page, 2).click()
    await label(page, 'Horizontal position').fill('96')
    await label(page, 'Proof notes').fill(PANEL_NOTES)
    await button(page, 'Add balloon').click()
    await label(page, 'Dialogue').fill(DIALOGUE)
    await button(page, 'Save changes').click()
    await saved(page)

    const originals = [await uploadImage(page, '#275b82'), await uploadImage(page, '#a45424')]
    for (const [index, original] of originals.entries()) {
      await label(page, 'Import layer PNG').setInputFiles({
        name: `key-layer-${index + 1}.png`, mimeType: 'image/png', buffer: original,
      })
      await poll(() => adoptedVersion(page).evaluate(element => (element as HTMLSelectElement).selectedOptions[0]?.label)).toBe(`Version ${index + 1}`)
      await saved(page)
      expect(await downloadedBytes(page, button(page, 'Export layer PNG'))).toEqual(original)
    }

    await page.reload({ waitUntil: 'load' })
    await openStudio(page, SOURCE_WORKSPACE, REOPEN_SESSION)
    await button(page, PROJECT_TITLE).click()
    await pageButton(page, 2).click()
    await poll(() => label(page, 'Dialogue').inputValue()).toBe(DIALOGUE)
    expect(await label(page, 'Proof notes').inputValue()).toBe(PANEL_NOTES)
    expect(await downloadedBytes(page, button(page, 'Export layer PNG'))).toEqual(originals[1])
    await adoptedVersion(page).selectOption({ label: 'Version 1' })
    await button(page, 'Save changes').click()
    await saved(page)
    expect(await downloadedBytes(page, button(page, 'Export layer PNG'))).toEqual(originals[0])

    const packageBytes = await downloadedBytes(page, button(page, 'Export project'))
    const comic = JSON.parse(packageBytes.toString('utf8')) as ComicProjectPackage
    expect(comic.draft.pages).toHaveLength(3)
    expect(comic.draft.pages[1]?.panels[0]?.x).toBe(96)
    expect(comic.draft.pages[1]?.panels[0]?.bubbles[0]?.text).toBe(DIALOGUE)
    expect(comic.images.map(image => image.data)).toEqual(expect.arrayContaining(originals.map(value => value.toString('base64'))))

    await openStudio(page, RESTORED_WORKSPACE, RESTORE_SESSION)
    expect(await button(page, PROJECT_TITLE).count()).toBe(0)
    await label(page, 'Import project').setInputFiles({
      name: 'borrowed-key.dsh-comic.json', mimeType: 'application/json', buffer: packageBytes,
    })
    await pageButton(page, 2).click()
    await poll(() => label(page, 'Dialogue').inputValue()).toBe(DIALOGUE)
    expect(await downloadedBytes(page, button(page, 'Export layer PNG'))).toEqual(originals[0])
    await label(page, 'Dialogue').fill('现在她拿着钥匙。')
    await button(page, 'Save changes').click()
    await saved(page)

    await button(page, 'Reading preview').click()
    await button(page, 'Back to editing').waitFor()
    const reader = await downloadedBytes(page, button(page, 'Export page PNG'))
    expect(reader.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect([reader.readUInt32BE(16), reader.readUInt32BE(20)]).toEqual([1200, 1600])
    expect(await countRenderedArtworkPixels(page, reader)).toBeGreaterThan(100)
    expect(consoleWatch.pageErrors).toEqual([])
  })
})
