/** Recorded model planning through the shipped Web profile and the real production canvas. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { SessionId } from '@deepseek-ai/dsh-session'
import { parseSnapshotManifest } from '@deepseek-ai/dsh-session-snapshot'
import type { VideoProjectInput } from '@deepseek-ai/dsh-video-production/types'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-video-production'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/video-workflow', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const SESSION_ID = SessionId('video-workflow-smoke')
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('recorded Web video workflow with full-access planning permissions', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  let planned: VideoProjectInput

  beforeAll(async () => {
    const fixture = await readFile(FIXTURE, 'utf8')
    const recorded = parseSessionLog(fixture)
    const call = recorded.find(event => event.type === 'tool/call' && event.data.name === 'video_project')
    if (call?.type !== 'tool/call') throw new Error('Video workflow fixture must contain its project update.')
    const args = JSON.parse(call.data.arguments) as { action: string; input: VideoProjectInput }
    expect(args.action).toBe('update')
    planned = args.input
    const [prompt] = fixtureUserPrompts(fixture)
    if (prompt === undefined) throw new Error('Video workflow fixture must contain its user prompt.')
    const permission = recorded.find(event => event.type === 'permission/preset')
    if (permission?.type !== 'permission/preset') throw new Error('Video workflow fixture must declare its permission preset.')
    const manifestPath = join(SNAPSHOT_DIR, 'snapshot.yml')
    const manifest = parseSnapshotManifest(await readFile(manifestPath, 'utf8'), manifestPath)
    expect(permission.data.preset).toBe(manifest.permission)
    scaffold = await launchWebScaffold({
      replayFixture: FIXTURE, compareReplaySession: true,
      agentPresets: { roots: [{ path: join(SNAPSHOT_DIR, 'presets'), trust: 'system' }], default: 'video-workflow' },
    })
    await scaffold.ctx.settings.update('permission', { defaultPreset: permission.data.preset })
    // Both hosts accept this absolute spelling, so the session header remains portable before snapshot capture.
    const cwd = scaffold.workspaceCwd.replaceAll('\\', '/')
    await scaffold.ctx.sessionController.create({ sessionId: SESSION_ID, cwd })
    const agent = scaffold.ctx.agents.get(SESSION_ID)
    if (agent === undefined) throw new Error('The Web Session API did not publish the video workflow Agent.')
    expect(agent.session.events.find(event => event.type === 'permission/preset')?.data.preset).toBe(permission.data.preset)
    const needed = [...new Set(recorded.filter(event => event.type === 'tool/call').map(event => event.data.name))]
    agent.ctx.effect(() => agent.ctx.tools.restrict({ allow: needed }), 'video-workflow recorded tool scope')
    const settled = scaffold.whenTurnSettled()
    agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await settled
    await agent.whenIdle()
    expect(agent.session.requestHeader()?.tools?.map(tool => tool.name)).toEqual(needed)
  })

  afterAll(async () => {
    const failures: unknown[] = []
    const collect = (error: unknown): void => {
      if (error instanceof AggregateError) {
        const nested: readonly unknown[] = error.errors
        failures.push(...nested)
      } else failures.push(error)
    }
    await page?.close().catch(collect)
    await browser?.close().catch(collect)
    await scaffold?.close().catch(collect)
    if (failures.length === 1) throw failures[0]
    if (failures.length > 0) throw new AggregateError(failures, 'Video workflow snapshot cleanup failed.')
  })

  it('persists the recorded model plan and renders its prompt, generation, result, assembly, and film nodes', async () => {
    if (scaffold === undefined) throw new Error('Video workflow scaffold is unavailable.')
    onTestFailed(async () => { if (page !== undefined) await saveFailureShot(page, 'web-video-workflow-snapshot') })
    const durable = await scaffold.ctx.sessionPersistence.readFrom(SESSION_ID, 0)
    expect(durable.events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(['video_project'])
    const result = durable.events.find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('The recorded video project tool result was not persisted.')
    expect(result.data.error).toBeUndefined()
    const project = await scaffold.ctx.videoProduction.view(SESSION_ID)
    expect(result.data.meta).toEqual(project)
    expect(project.title).toBe(planned.title)
    expect(project.assets).toEqual(planned.assets)
    expect(project.shots).toEqual(planned.shots.map(shot => ({ ...shot, versions: [] })))
    expect(project.exports).toEqual([])

    browser = await chromium.launch()
    page = await newEnglishPage(browser, 1120)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const group = page.getByRole('treeitem').first()
    await group.waitFor()
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    await page.getByRole('treeitem').nth(1).click()
    await page.getByRole('tab', { name: 'Video production', exact: true }).click()
    await expect.poll(() => page!.getByLabel('Project title', { exact: true }).inputValue()).toBe(planned.title)
    for (const kind of ['prompt', 'generation', 'video-result']) {
      await expect.poll(() => page!.locator(`[data-workflow-kind="${kind}"]`).count()).toBe(planned.shots.length)
    }
    expect(await page.locator('[data-workflow-kind="assembly"]').count()).toBe(1)
    expect(await page.locator('[data-workflow-kind="film"]').count()).toBe(1)
    const prompts = page.locator('[data-workflow-kind="prompt"] textarea')
    for (const [index, shot] of planned.shots.entries()) expect(await prompts.nth(index).inputValue()).toBe(shot.prompt)
    expect(await page.locator('[data-workflow-kind="assembly"] li strong').allTextContents())
      .toEqual(planned.shots.map(shot => shot.title))
    const aria = await captureStableAria(page, '.react-flow', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, aria, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it('keeps its recorded-session inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'presets', 'session.jsonl', 'system-prompt.expected.md', 'tool-schemas.expected.json', 'ui.expected.md',
    ])
  })
})
