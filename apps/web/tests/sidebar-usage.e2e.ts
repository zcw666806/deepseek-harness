/** Sidebar usage from two persisted Sessions before either conversation is opened. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./expected/sidebar-usage.expected.md', import.meta.url))
const USAGE = '[data-sidebar-usage]'
const LABEL = '31.6K tok · Cache hit 74%'
const TITLE = 'Token usage across 2 sessions (31,629 tok)'

it.skipIf(webSnapshotMode() === 'record')('shows the cached usage of two Sessions on the sidebar footer', async () => {
  const scaffold = await launchWebScaffold()
  onTestFinished(() => scaffold.close())
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
  for (const scenario of ['fresh-round-trip', 'turn-tail-actions']) {
    const fixture = new URL(`../../../snapshots/web/${scenario}/session.v4.jsonl`, import.meta.url)
    const id = await seedSession(scaffold, await readFile(fixture, 'utf8'), `sidebar-usage-${scenario}`)
    await workspace.attachSession(id)
    const log = await scaffold.ctx.sessionQuery.readSession(id)
    scaffold.ctx.sessionProjectionCache.coldSnapshot(log.session, log.inheritedEventCount, log.events)
    await expect.poll(() => scaffold.ctx.sessionProjectionCache.cachedSnapshot(log.session)?.values.tokenUsage)
      .toBeDefined()
  }

  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  const console = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-usage'))
  await page.goto(scaffold.authenticatedUrl)
  const reading = page.locator(USAGE)
  await reading.getByText(LABEL, { exact: true }).waitFor()
  await expect.poll(() => reading.getAttribute('title')).toBe(TITLE)
  expect(await page.locator('[data-composer-stat="usage"]').count()).toBe(0)
  await compareOrRefreshGolden(EXPECTED, await captureStableAria(page, USAGE, scaffold.workspaceCwd), webSnapshotMode())

  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await reading.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await reading.waitFor()
  expect(await reading.getAttribute('title')).toBe(TITLE)
  expect(console.pageErrors).toEqual([])
  expect(console.warnings).toEqual([])
})
