/** Verify that /models lists the saved route without a PTC or model turn. */
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

it.skipIf(webSnapshotMode() === 'record')('lists the current provider in PTC mode and times out a stalled listing body', async () => {
  const requests: { url: string | undefined; authorization: string | undefined; method: string | undefined }[] = []
  const stalledBodyClosed = Promise.withResolvers<boolean>()
  const provider = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization, method: request.method })
    response.writeHead(200, { 'content-type': 'application/json' })
    if (requests.length === 1) {
      response.end(JSON.stringify({ data: [{ id: 'listed-by-provider' }] }))
      return
    }
    response.on('close', () => { stalledBodyClosed.resolve(true) })
    response.write('{"data":[')
  })
  provider.listen(0, '127.0.0.1')
  onTestFinished(() => {
    provider.closeAllConnections()
    return new Promise<void>((resolve, reject) => {
      provider.close((error) => { if (error) reject(error); else resolve() })
    })
  })
  await once(provider, 'listening')
  const address = provider.address()
  if (address === null || typeof address === 'string') throw new Error('Model listing fixture did not open a TCP port')

  const temp = await mkdtemp(join(tmpdir(), 'dsh-model-list-'))
  onTestFinished(() => rm(temp, { recursive: true, force: true }))
  const overlay = join(temp, 'models.yml')
  await writeFile(overlay, [
    '- id: llm', '  config: { modelListingTimeoutMs: 1000 }',
    '- id: agent-default-model', '  config: { provider: fixture-models, model: local-catalog-entry }',
    '- id: llm-pi-ai', '  config:', '    providers:', '      fixture-models:',
    '        api: openai-completions', `        baseURL: http://127.0.0.1:${address.port}/gateway/v1`,
    '        apiKeyEnv: DSH_TEST_LISTING_KEY', '        models:', '          - id: local-catalog-entry', '',
  ].join('\n'))
  const scaffold = await launchWebScaffold({ extraOverlayPath: overlay, agentPresets: { default: 'ptc' } })
  onTestFinished(() => scaffold.close())
  await scaffold.ctx.credentials.set(credentialRef('DSH_TEST_LISTING_KEY'), 'fixture-model-list-key')
  const events: SessionEvent[] = []
  scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })

  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const input = page.locator('[data-composer-input]').first()
  await input.fill('/models')
  await input.press('Enter')
  await expect.poll(() => events.filter(event => event.type === 'command/done').map(event => event.data), {
    timeout: 5_000,
  }).toMatchObject([{ kind: 'success', text: 'fixture-models returned 1 model(s). Listing only.\nlisted-by-provider' }])
  await page.getByText(/fixture-models returned 1 model\(s\).*listed-by-provider/su).waitFor({ timeout: 5_000 })
  const expectedRequest = { url: '/gateway/v1/models', authorization: 'Bearer fixture-model-list-key', method: 'GET' }
  expect(requests).toEqual([expectedRequest])

  await input.fill('/models')
  await input.press('Enter')
  await page.getByText(/provider model listing timed out after 1000 ms/u).waitFor({ timeout: 5_000 })
  expect(await stalledBodyClosed.promise).toBe(true)
  expect(requests).toEqual([expectedRequest, expectedRequest])
  expect(events.filter(event => event.type === 'command/done')).toHaveLength(2)
  expect(events.some(event => event.type === 'user/message' || event.type === 'turn/start' || event.type === 'tool/call')).toBe(false)
  expect(JSON.stringify(events)).not.toContain('fixture-model-list-key')
}, 120_000)
