import { createInterface } from 'node:readline'

const tools = [
  { name: 'trial_fetch', description: 'Return the owned REA trial evidence.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'trial_status', description: 'Report the owned REA trial status.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
]
const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  let result
  switch (request.method) {
    case 'initialize':
      result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'rea-snapshot-fixture', version: '1.0.0' } }
      break
    case 'ping':
      result = {}
      break
    case 'tools/list':
      result = { tools }
      break
    case 'tools/call':
      if (request.params.name !== 'trial_fetch' && request.params.name !== 'trial_status') {
        throw new Error(`unexpected fixture tool: ${request.params.name}`)
      }
      result = { content: [{ type: 'text', text: request.params.name === 'trial_fetch' ? 'REA_TRIAL_OK' : 'REA_TRIAL_READY' }] }
      break
    default:
      throw new Error(`unexpected fixture request: ${request.method}`)
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`)
})
