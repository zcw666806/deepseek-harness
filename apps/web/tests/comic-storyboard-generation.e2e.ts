/** Comic planning in Chat, Workspace file creation, and independent image routing. */
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createMessage, createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode } from './scaffold.ts'
import { closeCreationStudio, newEnglishPage, saveFailureShot, selectCreationMode, writeComposerDraft } from './support.ts'

const MODE = webSnapshotMode()
const SESSION_TITLE = 'Hedgehog storyboard'
const WORKSPACE_TITLE = 'Storyboard workspace'
const TITLE = '给自己留一盏灯'
const CREDENTIAL = 'COMIC_TEST_API_KEY'
const PLANNER_PROVIDER = 'comic-test-planner'
const PLANNER_MODEL = 'fixture-story-planner'
const IMAGE_TARGET = 'fixture-second-image'
const IMAGE_MODEL = 'fixture-alternate-artist'
const PROJECT_DIRECTORY = 'night-light-comic'
const COMIC_BRIEF = `Create a four-panel comic about a hedgehog who shares a night light. Use the project folder ${PROJECT_DIRECTORY}.`
const PLANNED_TITLE = '雾里的灯'
const DOCUMENT_NAME = 'storyboard.md'
const RESULT = '[data-comic-storyboard-result]'
const GOLDEN = fileURLToPath(new URL('./expected/comic-storyboard-generation.expected.md', import.meta.url))

// A square PNG with a different color in each quadrant exercises extraction and lettering.
const ARTWORK = 'iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAMAAABlApw1AAAADFBMVEVxQSbgpkD42ZO3aSxZu8miAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABeUlEQVR4nO3SMRHAMADDQCfhz7kMqkmbnoHO3pMd2QoALQC6EDmyPVkBoAXIke3JCgAtQI5sT1YAaAFyZHuyAkALkCPbkxUAWoAc2Z6sANAC5Mj2ZAWAFiBHticrALQAObI9WQGgBciR7ckKAC1AjmxPVgBoAXJke7ICQAuQI9uTFQBagBzZnqwA0ALkyPZkBYAWIEe2JysAtAA5sj1ZAaAFyJHtyQoALUCObE9WAGgBcmR7sgJAC5Aj25MVAFqAHNmerADQAuTI9mQFgNmubAWAFgCzXdkKAC0AZruyFQBaAMx2ZSsAtACY7cpWAGgBMNuVrQDQAmC2K1sBoAXAbFe2AkALgNmubAWAFgCzXdkKAC0AZruyFQBaAMx2ZSsAtACY7cpWAGgBMNuVrQDQAmC2K1sBoAXAbFe2AkALgNmubAWAFgCzXdkKAC0AZruyFQBaAMx2ZSsAtACY7cpWAGgBMNuVrQDQAmC2K1sBoAXAbFe2AkAL3H8fPa3YAdnPvIEAAAAASUVORK5CYII='

const STORY = [
  `《${TITLE}》`, '暖黄、米白和浅棕。', '',
  '**第一格**', '画面：门缝下漏出一条暖光。', '动作：小刺猬背着包回到家。', '对白：（无）', '',
  '**第二格**', '画面：门开了一半，小灯亮在桌上。', '动作：小刺猬轻轻推门。', '对白：「还亮着。」', '',
  '**第三格**', '画面：灯旁有一张写着「到家啦」的便签。', '动作：小刺猬碰了碰便签。', '对白：（无）', '',
  '**第四格**', '画面：桌边一片暖光。', '动作：小刺猬坐下来，把灯转向便签。', '对白：（无）',
].join('\n')

/** Write the storyboard through the standard Agent's filesystem tool before returning it in Chat. */
class StoryPlanner extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly documentPath: string) {
    super()
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: PLANNER_MODEL, name: 'Fixture Story Planner' }])
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const text = STORY.replace(TITLE, PLANNED_TITLE)
    if (this.requests.length === 1) {
      const id = ToolCallId('fixture-save-storyboard')
      const argumentsJson = JSON.stringify({ file_path: this.documentPath, content: `# ${PLANNED_TITLE}\n\n${text}\n` })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'write', argumentsDelta: argumentsJson }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'write', arguments: argumentsJson } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function appendStoryboardTurn(session: Session, title: string, request: string, storyboard: string): void {
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: request }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', { title, messageSeqs: [user.seq], source: { kind: 'user' } })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant', content: [{ type: 'text', text: storyboard }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

function storyFixture(): string {
  const session = Session.create(SessionId('comic-storyboard-source'))
  appendStoryboardTurn(session, SESSION_TITLE, `请画一张四格漫画《${TITLE}》`, STORY)
  return [
    JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', createdAt: 0, cwd: '{{cwd}}' }),
    ...session.events.map(event => JSON.stringify(event)), '',
  ].join('\n')
}

it.skipIf(MODE === 'record')('plans and writes the storyboard from Chat and routes artwork independently', async () => {
  const received: { path: string | undefined; method: string | undefined; authorization: string | undefined; body: string }[] = []
  const provider = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      received.push({ path: request.url, method: request.method, authorization: request.headers.authorization, body })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ b64_json: ARTWORK }] }))
    })
  })
  provider.listen(0, '127.0.0.1')
  onTestFinished(() => new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve())))
  await once(provider, 'listening')
  const address = provider.address()
  if (address === null || typeof address === 'string') throw new Error('Image fixture did not open a TCP port')
  const temp = await mkdtemp(join(tmpdir(), 'dsh-comic-storyboard-'))
  onTestFinished(() => rm(temp, { recursive: true, force: true }))
  const overlay = join(temp, 'comic.yml')
  await writeFile(overlay, [
    '- id: comic-production', '  disabled: false', '  config:', '    imageGeneration:',
    `      baseURL: "http://127.0.0.1:${address.port}/v1"`, `      credentialRef: ${CREDENTIAL}`,
    '      model: fixture-comic-model', '    imageGenerationTargets:',
    `      - id: ${IMAGE_TARGET}`, '        title: Fixture Alternate Artist',
    `        baseURL: "http://127.0.0.1:${address.port}/v1"`, `        credentialRef: ${CREDENTIAL}`,
    `        model: ${IMAGE_MODEL}`, '- id: ui-comic-production', '  disabled: false', '',
  ].join('\n'))
  const scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
  onTestFinished(() => scaffold.close())
  await scaffold.ctx.credentials.set(credentialRef(CREDENTIAL), 'comic-test-key')
  const documentPath = join(scaffold.workspaceCwd, PROJECT_DIRECTORY, DOCUMENT_NAME)
  const planner = new StoryPlanner(documentPath)
  scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter([PLANNER_PROVIDER], planner), 'comic test planning adapter')
  const defaultPlanningModel = scaffold.ctx.agentDefaultModel.currentSelection()
  const fixture = storyFixture().replaceAll('{{cwd}}', JSON.stringify(scaffold.workspaceCwd).slice(1, -1))
  const sessionId = await seedSession(scaffold, fixture, 'comic-storyboard-generation')
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, WORKSPACE_TITLE)
  await workspace.attachSession(sessionId)

  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  onTestFailed(() => saveFailureShot(page, 'web-e2e-comic-storyboard-generation'))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  const treeItems = page.getByRole('treeitem')
  const group = treeItems.and(page.locator('[aria-expanded]')).filter({ has: page.getByText(WORKSPACE_TITLE, { exact: true }) })
  await group.waitFor()
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
  const sessionRow = (title: string) => treeItems.and(page.locator('[aria-selected]'))
    .filter({ has: page.getByText(title, { exact: true }) })
  await sessionRow(SESSION_TITLE).click()
  const composer = page.locator('[data-composer-card]')
  const imageModel = composer.getByRole('button', { name: /^Image generation model\b/u })
  const imageOptions = page.getByRole('menu', { name: 'Image generation model', exact: true })
  const defaultArtist = imageOptions.getByRole('menuitemradio', { name: 'fixture-comic-model', exact: true })
  const alternateArtist = imageOptions.getByRole('menuitemradio', { name: /^Fixture Alternate Artist\b/u })
  await selectCreationMode(page, 'comic')
  await expect.poll(() => imageModel.isEnabled()).toBe(true)
  await imageModel.press('ArrowDown')
  await expect.poll(() => defaultArtist.evaluate(element => element === document.activeElement)).toBe(true)
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => alternateArtist.evaluate(element => element === document.activeElement)).toBe(true)
  await page.keyboard.press('Enter')
  await expect.poll(() => scaffold.ctx.comicProduction.storyboardGenerationTarget(sessionId)).toBe(IMAGE_TARGET)

  const generate = page.getByRole('button', { name: 'Generate four-panel comic', exact: true })
  await expect.poll(() => generate.isEnabled()).toBe(true)
  expect(received).toHaveLength(0)
  await generate.click()
  const result = page.locator(RESULT)
  await expect.poll(() => result.getByRole('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  expect(received).toHaveLength(1)
  expect(received[0]).toMatchObject({ path: '/v1/images/generations', method: 'POST', authorization: 'Bearer comic-test-key' })
  expect(JSON.parse(received[0]!.body)).toMatchObject({ model: IMAGE_MODEL, prompt: expect.stringContaining('小刺猬') })
  const snapshot = await captureStableAria(page, RESULT, scaffold.workspaceCwd)
  await compareOrRefreshGolden(GOLDEN, snapshot.replaceAll(`blob:${new URL(page.url()).origin}/`, 'blob:{{origin}}/'), MODE)

  await page.reload({ waitUntil: 'load' })
  await result.getByRole('img').waitFor()
  expect(received).toHaveLength(1)
  await result.getByRole('button', { name: 'Open editor', exact: true }).click()
  await page.getByRole('dialog', { name: 'Comic creation', exact: true }).waitFor()
  for (const number of [1, 2, 3, 4]) {
    await page.getByRole('button', { name: `Panel ${number}`, exact: true }).click()
    await expect.poll(() => page.getByRole('combobox', { name: 'Adopted version', exact: true })
      .evaluate(element => (element as HTMLSelectElement).selectedOptions[0]?.label)).toBe('Version 1')
  }
  await page.getByRole('button', { name: 'Panel 2', exact: true }).click()
  const dialogue = page.getByRole('textbox', { name: 'Dialogue', exact: true })
  expect(await dialogue.inputValue()).toContain('还亮着')
  await dialogue.fill('灯还亮着。')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('status').filter({ hasText: /^Saved$/u }).waitFor()
  await closeCreationStudio(page, 'comic')

  const alternateTarget = (await scaffold.ctx.comicProduction.storyboardGenerationTargets())
    .find(target => target.id === IMAGE_TARGET)
  if (alternateTarget === undefined) throw new Error('Configured comic test route is unavailable.')
  const alternateTargetId = alternateTarget.id
  const addLiveStoryboard = async (id: string, title: string, request: string, storyboardTitle: string): Promise<void> => {
    const { agent } = await scaffold.ctx.agents.create({
      sessionId: SessionId(id), meta: { cwd: scaffold.workspaceCwd },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    await workspace.attachSession(agent.id)
    await scaffold.ctx.comicProduction.selectStoryboardGenerationTarget(agent.id, alternateTargetId)
    appendStoryboardTurn(agent.session, title, request, STORY.replace(TITLE, storyboardTitle))
    await expect(scaffold.ctx.sessions.flush(agent.session)).resolves.toBe(true)
    await page.reload({ waitUntil: 'load' })
    await group.waitFor()
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
  }

  const reviewTitle = 'Storyboards for review'
  await addLiveStoryboard('comic-storyboard-review', reviewTitle, '请画一张四格漫画《晚安松鼠》，先给我看分镜，等我确认再出图。', '晚安松鼠')
  await sessionRow(reviewTitle).click()
  await expect.poll(() => generate.isEnabled()).toBe(true)
  expect(received).toHaveLength(1)

  const directTitle = 'Requested comic image'
  await addLiveStoryboard('comic-storyboard-direct', directTitle, '请画一张四格漫画《晚安月亮》', '晚安月亮')
  await sessionRow(directTitle).click()
  await expect.poll(() => result.getByRole('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  expect(received).toHaveLength(2)
  expect(JSON.parse(received[1]!.body)).toMatchObject({ model: IMAGE_MODEL, prompt: expect.stringContaining('晚安月亮') })

  await sessionRow(reviewTitle).click()
  await expect.poll(() => generate.isEnabled()).toBe(true)
  expect(received).toHaveLength(2)

  const composerDraft = composer.locator('[data-composer-input]')
  await writeComposerDraft(page, composerDraft, COMIC_BRIEF)
  const originalInput = await composerDraft.elementHandle()
  if (originalInput === null) throw new Error('The active conversation has no composer.')
  await selectCreationMode(page, 'comic')
  expect(await composerDraft.evaluate((element, original) => element === original, originalInput)).toBe(true)
  await expect.poll(() => composerDraft.textContent()).toBe(COMIC_BRIEF)
  expect(await page.getByRole('dialog', { name: 'Comic creation', exact: true }).count()).toBe(0)
  await expect.poll(() => imageModel.textContent()).toContain('Fixture Alternate Artist')
  await imageModel.click()
  await expect.poll(() => alternateArtist.getAttribute('aria-checked')).toBe('true')
  await alternateArtist.press('Escape')
  await expect.poll(() => imageModel.getAttribute('aria-expanded')).toBe('false')
  await expect.poll(() => imageModel.evaluate(element => element === document.activeElement)).toBe(true)
  const planningModel = composer.getByRole('button', { name: /^(?:Select |Choose )?Planning model\b/iu })
  await planningModel.click()
  await page.getByRole('menuitem', { name: /^Model\b/u }).click()
  await page.getByRole('menuitemradio', { name: 'Fixture Story Planner', exact: true }).click()
  await expect.poll(() => planningModel.getAttribute('aria-label')).toContain('Fixture Story Planner')
  const send = composer.getByRole('button', { name: 'Send message', exact: true })
  const [settled] = await Promise.all([scaffold.whenTurnSettled(), send.click()])
  expect(settled).toBe(SessionId('comic-storyboard-review'))
  await page.getByText(`《${PLANNED_TITLE}》`).waitFor()
  expect(planner.requests).toHaveLength(2)
  for (const request of planner.requests) expect(request).toMatchObject({ provider: PLANNER_PROVIDER, model: PLANNER_MODEL })
  const request = planner.requests[0]?.messages.findLast(message => message.source.kind === 'user')?.content[0]
  if (request?.type !== 'text') throw new Error('Creative brief was not sent as a text message.')
  expect(request.text).toContain('.md')
  expect(request.text).toContain(COMIC_BRIEF)
  const durable = await scaffold.ctx.sessionPersistence.readFrom(SessionId('comic-storyboard-review'), 0)
  expect(durable.events.findLast(event => event.type === 'request/header')?.data.header.config)
    .toMatchObject({ provider: PLANNER_PROVIDER, model: PLANNER_MODEL })
  expect(durable.events.findLast(event => event.type === 'tool/call')?.data.name).toBe('write')
  const resultEvent = durable.events.findLast(event => event.type === 'tool/result')
  const writeResult = resultEvent?.data.message.content[0]
  expect(writeResult?.isError, JSON.stringify(writeResult?.content)).toBe(false)
  expect(await readFile(documentPath, 'utf8')).toBe(`# ${PLANNED_TITLE}\n\n${STORY.replace(TITLE, PLANNED_TITLE)}\n`)
  expect(scaffold.ctx.agentDefaultModel.currentSelection()).toEqual(defaultPlanningModel)
  expect(received).toHaveLength(2)
})
