/** Protocol peer forwarding one canonical JSONL recording without launching its plugins. */

import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

interface RecordedEvent {
  type: string
  data: Record<string, unknown>
}

const path = process.env.SDK_RECORDED_SESSION
if (path === undefined) throw new Error('SDK_RECORDED_SESSION is required')
const events = readFileSync(path, 'utf8').trim().split('\n')
  .map(line => JSON.parse(line) as RecordedEvent)
  .filter(record => record.type !== 'session')
const receipt = events.find(record => record.type === 'agent/inbox/spliced'
  && Array.isArray(record.data.inserted) && record.data.inserted.length > 0)
if (receipt === undefined) throw new Error('recording has no prompt receipt')
const messageId = (receipt.data.inserted as { id: string }[])[0]!.id

function send(message: object): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line) as { id: string; method: string; params?: { sessionId: string } }
  const respond = (result: object): void => { send({ jsonrpc: '2.0', id: request.id, result }) }
  switch (request.method) {
    case 'initialize':
      respond({ serverInfo: { name: 'recorded-session-peer', version: '1' } })
      return
    case 'session/prompt': {
      const sessionId = request.params!.sessionId
      for (const [seq, event] of events.entries()) {
        send({ jsonrpc: '2.0', method: 'session.event', params: { sessionId, event: { ...event, seq, time: 0 } } })
      }
      send({ jsonrpc: '2.0', method: 'session.status', params: { sessionId, status: 'idle' } })
      respond({ messageId })
      return
    }
    case 'shutdown':
      respond({})
      setImmediate(() => { process.exit(0) })
  }
})
