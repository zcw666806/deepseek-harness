/** Owned stdio fixture reporting process startup, tools, and graceful termination. */

import { appendFile } from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'

const [journal, mode, diagnosticArgument] = process.argv.slice(2)
if (journal === undefined) throw new Error('fixture requires its owned journal path')
const record = (event: string) => appendFile(journal, `${JSON.stringify({ event, pid: process.pid })}\n`)
await record('started')
if (mode === 'exit') process.exit(2)
let calls = 0
const tools = [
  { name: 'identity', description: 'Report this owned process and its call count.', inputSchema: { type: 'object' as const } },
  { name: 'second', description: 'A second advertised tool.', inputSchema: { type: 'object' as const } },
]
// Raw protocol handlers let the invalid-tools case advertise a duplicate name.
const server = new McpServer({ name: 'rea-experiment-fixture', version: '1' }, { capabilities: { tools: {} } })
server.server.setRequestHandler('tools/list', async () => {
  await record('listed')
  if (mode === 'argument-error') throw new Error(`fixture rejected ${diagnosticArgument ?? ''}\n${'x'.repeat(2_000)}`)
  return { tools: mode === 'invalid-tools' ? [tools[0]!, tools[0]!] : tools }
})
server.server.setRequestHandler('tools/call', () => ({
  content: [{ type: 'text', text: JSON.stringify({ pid: process.pid, calls: ++calls }) }],
}))
process.stdin.once('end', () => {
  void record('closed').then(() => server.close())
})
await server.connect(new StdioServerTransport())
