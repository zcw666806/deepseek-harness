/** Open the current workspace storyboard in the video canvas from a settled Chat reply. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-video-production'
import type {} from '@deepseek-ai/dsh-workspace'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { launchWebScaffold, renderSeedFixture, seedSession, watchConsole, webSnapshotMode } from './scaffold.ts'
import { closeCreationStudio, newEnglishPage, saveFailureShot, writeComposerDraft } from './support.ts'

const SESSION_TITLE = 'Station video plan'
const WORKSPACE_TITLE = 'Video storyboard workspace'
const PROJECT_TITLE = '月光站台'
const STORYBOARD_PATH = 'moonlit-station/storyboard.md'
const REPLY = 'The video storyboard is ready to review.'
const DRAFT = 'Let us review the second shot.'
const SHOTS = [
  { title: '站台相遇', prompt: 'A slow tracking shot of two travelers on a moonlit station platform.', duration: 5 },
  { title: '汽笛远去', prompt: 'The train pulls away as the station clock fills the frame.', duration: 7 },
]
const SOURCE = { provider: 'fixture', model: 'fixture' }

function storyboardDocument(): string {
  return [
    `# ${PROJECT_TITLE}`, '', '- 分辨率：720p', '', '## 镜头', '',
    ...SHOTS.flatMap((shot, index) => [
      `### 0${index + 1} ${shot.title}`, `- 时长：${shot.duration} 秒`, '- 画幅：9:16',
      `- 生成提示词：${shot.prompt}`, '',
    ]),
    '## 生成记录', '', '| 镜号 | 状态 |', '| --- | --- |', '| 01 | 待生成 |', '',
  ].join('\n')
}

function writtenStoryboardFixture(): string {
  const session = Session.create(SessionId('video-workspace-storyboard-source'))
  const turnStart = session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Plan a two-shot video about a night train.' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const title = session.append('session/title', { title: SESSION_TITLE, messageSeqs: [], source: { kind: 'user' } })

  const callId = ToolCallId('write-video-storyboard')
  const args = JSON.stringify({ file_path: STORYBOARD_PATH, content: '# Early draft\n' })
  const writeStart = session.append('step/start', { turn: 1, step: 1 })
  const writeMessage = session.append('assistant/message', {
    turn: 1, step: 1, stream: [], message: createAssistantMessage({
      content: [{ type: 'tool-call', id: callId, name: 'write', arguments: args }], source: SOURCE,
    }),
  }, { surfaceOp: 'append' })
  const call = session.append('tool/call', { turn: 1, step: 1, callId, name: 'write', arguments: args })
  const result = session.append('tool/result', {
    turn: 1, step: 1, message: createToolResultMessage({
      callId, content: [{ type: 'text', text: `Created ${STORYBOARD_PATH}` }], isError: false,
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  const writeEnd = session.append('step/end', { turn: 1, step: 1 })

  const replyStart = session.append('step/start', { turn: 1, step: 2 })
  const reply = session.append('assistant/message', {
    turn: 1, step: 2, stream: [], message: createAssistantMessage({
      content: [{ type: 'text', text: `${REPLY}\n\n[Video storyboard](${STORYBOARD_PATH})` }], source: SOURCE,
    }),
  }, { surfaceOp: 'append' })
  const replyEnd = session.append('step/end', { turn: 1, step: 2 })
  const turnEnd = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const header = JSON.stringify({ type: 'session', ...session.header, id: '{{sessionId}}', createdAt: 0, cwd: '{{cwd}}', delegationDepth: 0 })
  return renderSeedFixture(header, [
    turnStart, user, title, writeStart, writeMessage, call, result, writeEnd, replyStart, reply, replyEnd, turnEnd,
  ])
}

it.skipIf(webSnapshotMode() === 'record')('opens the current Markdown storyboard as editable video shots from Chat', async () => {
  const scaffold = await launchWebScaffold()
  onTestFinished(() => scaffold.close())
  const documentPath = join(scaffold.workspaceCwd, STORYBOARD_PATH)
  const markdown = storyboardDocument()
  await mkdir(dirname(documentPath), { recursive: true })
  await writeFile(documentPath, markdown)
  const fixture = writtenStoryboardFixture().replaceAll('{{cwd}}', JSON.stringify(scaffold.workspaceCwd).slice(1, -1))
  const sessionId = await seedSession(scaffold, fixture, 'video-workspace-storyboard')
  await scaffold.ctx.sessionController.rename({ sessionId, title: SESSION_TITLE })
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, WORKSPACE_TITLE)
  await workspace.attachSession(sessionId)
  expect((await scaffold.ctx.videoProduction.view(sessionId)).revision).toBe(0)

  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  onTestFailed(() => saveFailureShot(page, 'web-e2e-video-workspace-storyboard'))
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  const treeItems = page.getByRole('treeitem')
  const group = treeItems.and(page.locator('[aria-expanded]')).filter({ has: page.getByText(WORKSPACE_TITLE, { exact: true }) })
  await group.waitFor()
  await expect.poll(async () => {
    if (await group.getAttribute('aria-expanded') !== 'true') {
      await group.getByText(WORKSPACE_TITLE, { exact: true }).click()
    }
    return group.getAttribute('aria-expanded')
  }).toBe('true')
  await treeItems.and(page.locator('[aria-selected]')).filter({ has: page.getByText(SESSION_TITLE, { exact: true }) }).click()

  const composer = page.locator('[data-composer-card] [data-composer-input]')
  await writeComposerDraft(page, composer, DRAFT)
  const originalInput = await composer.elementHandle()
  if (originalInput === null) throw new Error('The active conversation has no composer.')
  const open = page.getByRole('button', { name: 'Open storyboard canvas', exact: true })
  const tail = page.locator('[data-turn-tail]').filter({ has: open })
  await tail.waitFor()
  const dialog = page.getByRole('dialog', { name: 'Video creation', exact: true })
  expect(await dialog.isVisible()).toBe(false)
  await open.click()
  const projectTitle = dialog.getByRole('textbox', { name: 'Project title', exact: true })
  await expect.poll(() => projectTitle.inputValue()).toBe(PROJECT_TITLE)
  const prompts = dialog.locator('[data-workflow-kind="prompt"]')
  await expect.poll(() => prompts.count()).toBe(SHOTS.length)
  for (const [index, shot] of SHOTS.entries()) {
    const node = prompts.nth(index)
    expect(await node.locator('input').inputValue()).toBe(shot.title)
    expect(await node.locator('textarea').inputValue()).toBe(shot.prompt)
    expect(await node.locator('footer').textContent()).toBe(`${shot.duration}s`)
  }
  expect(await dialog.locator('video').count()).toBe(0)
  const imported = await scaffold.ctx.videoProduction.view(sessionId)
  expect(imported.revision).toBe(1)
  expect(imported.shots.map(({ title, prompt, duration, aspectRatio, resolution, versions }) => ({
    title, prompt, duration, aspectRatio, resolution, versions,
  }))).toEqual(SHOTS.map(shot => ({ ...shot, aspectRatio: '9:16', resolution: '720p', versions: [] })))
  expect(await readFile(documentPath, 'utf8')).toBe(markdown)

  await closeCreationStudio(page, 'video')
  await page.getByText(REPLY, { exact: true }).waitFor()
  expect(await composer.evaluate((element, original) => element === original, originalInput)).toBe(true)
  expect(await composer.textContent()).toBe(DRAFT)
  await writeFile(documentPath, markdown.replace(PROJECT_TITLE, 'Edited source title'))
  await open.click()
  await expect.poll(() => projectTitle.inputValue()).toBe(PROJECT_TITLE)
  expect(await scaffold.ctx.videoProduction.view(sessionId)).toEqual(imported)
  expect(tripwire.pageErrors).toEqual([])
})
