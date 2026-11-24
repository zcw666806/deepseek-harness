/** SDK notification and owned-turn projections of the Web-owned REA recording. */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { createProcessDeepSeekHarness } from '../src/api.ts'
import { isRecord } from '../src/client.ts'
import type { HarnessNotification } from '../src/types.ts'

it('preserves the REA selection on raw notifications and excludes pre-receipt setup from the owned turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sdk-rea-projection-'))
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const source = fileURLToPath(new URL('../../../../snapshots/web/rea-experiment/session.jsonl', import.meta.url))
  await using harness = createProcessDeepSeekHarness({
    command: process.execPath,
    args: [fileURLToPath(new URL('./recorded-session-runtime.ts', import.meta.url))],
    cwd: root,
    environment: () => ({ ...process.env as Record<string, string>, SDK_RECORDED_SESSION: source }),
    description: 'recorded Web session protocol peer',
    initializeTimeoutMs: 5_000,
  })
  await harness.start()
  const subscription = harness.client.subscribe()
  try {
    const result = await harness.run('Project the recorded Web turn.', { sessionId: 'rea-projection' })
    const observed: HarnessNotification[] = []
    let next: HarnessNotification | undefined
    while ((next = subscription.tryNext()) !== undefined) observed.push(next)
    const rawEvents = observed.flatMap(notification => notification.method === 'session.event' && isRecord(notification.params.event)
      ? [notification.params.event]
      : [])
    const projection = {
      selectionData: rawEvents.filter(event => event.type === 'rea-experiment/selected').map(event => event.data),
      rawEventTypes: rawEvents.map(event => event.type),
      eventTypes: result.events.map(event => event.type),
      finalResponse: result.finalResponse,
      finishReason: result.events.flatMap(event => event.type === 'turn/end' ? [event.data.reason.kind] : []).at(-1),
    }
    expect(KNOWN_SESSION_EVENT_TYPES.has('rea-experiment/selected')).toBe(true)
    const expected = JSON.parse(await readFile(new URL('./expected/rea-experiment-projection.json', import.meta.url), 'utf8')) as unknown
    expect(projection).toEqual(expected)
  } finally {
    subscription.close()
  }
})
