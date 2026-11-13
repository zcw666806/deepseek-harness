/** Resource-only stdio fixture shared by Loader and recorded-session coverage. */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({ name: 'resource-fixture', version: '1.0.0' })
server.registerResource('guide', 'docs:guide', { mimeType: 'text/markdown', description: 'Fixture guide' }, uri => ({
  contents: [{ uri: uri.href, mimeType: 'text/markdown', text: '# Resource guide\nResources are fetched on demand.' }],
}))
server.registerResource('binary', 'docs:binary', { mimeType: 'application/octet-stream' }, uri => ({
  contents: [{ uri: uri.href, mimeType: 'application/octet-stream', blob: 'cHJpdmF0ZSBiaW5hcnkgcGF5bG9hZA==' }],
}))
await server.connect(new StdioServerTransport())
