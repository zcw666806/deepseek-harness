/** Real MCP protocol coverage for on-demand resources and native tool policy. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ListResourcesRequest, ServerCapabilities } from '@modelcontextprotocol/sdk/types.js'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { syncTools } from '@deepseek-ai/dsh-mcp-client/src/tools.ts'
import type { ToolBridgeOptions, ToolDisposers } from '@deepseek-ai/dsh-mcp-client/src/tools.ts'

const opts: ToolBridgeOptions = { serverName: 'docs', toolCallTimeoutMs: 60_000, registrationFailure: 'throw' }
let ctx: Context | undefined
let client: Client | undefined
let server: McpServer['server'] | undefined
let disposers: ToolDisposers = new Map()

afterEach(async () => {
  for (const dispose of disposers.values()) dispose()
  disposers = new Map()
  await client?.close()
  await server?.close()
  await ctx?.fiber.dispose()
  ctx = undefined
  client = undefined
  server = undefined
})

async function harness(capabilities: ServerCapabilities = { resources: {} }) {
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  server = new McpServer({ name: 'docs', version: '1' }, { capabilities }).server
  client = new Client({ name: 'test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  const context = ctx
  const connection = client
  return {
    ctx: context,
    client: connection,
    server,
    async sync() { disposers = await syncTools(connection, context, opts, disposers) },
    execute(name: 'list' | 'read', args: Record<string, unknown> = {}, signal = new AbortController().signal) {
      return context.tools.execute({
        callId: ToolCallId(`resource-${name}`), name: `mcp_resource__docs__${name}`, arguments: args, signal,
      })
    },
  }
}

describe('MCP resources', () => {
  it('registers a resource-only server without fetching a tool list or resource contents', async () => {
    const h = await harness()
    await h.sync()
    expect(h.ctx.tools.schemas().map(tool => tool.name)).toEqual(['mcp_resource__docs__list', 'mcp_resource__docs__read'])
    expect(h.ctx.tools.get('mcp_resource__docs__list')?.presentCall?.({})).toEqual({
      card: 'generic', title: 'docs: resources', kind: 'read',
    })
    expect(h.ctx.tools.get('mcp_resource__docs__read')?.presentCall?.({ uri: 'docs:a' })).toEqual({
      card: 'generic', title: 'docs: resource', kind: 'read', rawInput: { uri: 'docs:a' },
    })
    for (const dispose of disposers.values()) dispose()
    expect(h.ctx.tools.schemas()).toEqual([])
  })

  it('keeps remote tools and resource operations in separate namespaces', async () => {
    const h = await harness({ tools: {}, resources: {} })
    h.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [{ name: 'list', inputSchema: { type: 'object' } }],
    }))
    await h.sync()
    expect(h.ctx.tools.schemas().map(tool => tool.name)).toEqual([
      'mcp_resource__docs__list', 'mcp_resource__docs__read', 'mcp__docs__list',
    ])
  })

  it('omits resource operations for tools-only servers', async () => {
    const h = await harness({ tools: {} })
    h.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }))
    await h.sync()
    expect(h.ctx.tools.schemas()).toEqual([])
  })

  it('lists one page and returns the opaque cursor without draining later pages', async () => {
    const h = await harness()
    const list = vi.fn((request: ListResourcesRequest) => request.params?.cursor === undefined
      ? { resources: [{ uri: 'docs:a', name: 'a', title: 'A', description: 'Guide', mimeType: 'text/plain', size: 4 }], nextCursor: 'page two/令牌' }
      : { resources: [{ uri: 'docs:b', name: 'b' }] })
    h.server.setRequestHandler(ListResourcesRequestSchema, list)
    await h.sync()
    const first = await h.execute('list')
    expect(first.isError).toBe(false)
    expect(first.value).toEqual({
      resources: [{ uri: 'docs:a', name: 'a', title: 'A', description: 'Guide', mimeType: 'text/plain', size: 4 }],
      nextCursor: 'page two/令牌',
    })
    expect(list).toHaveBeenCalledTimes(1)
    const second = await h.execute('list', { cursor: 'page two/令牌' })
    expect(second.value).toEqual({ resources: [{ uri: 'docs:b', name: 'b' }] })
    expect(list.mock.calls[1]?.[0].params?.cursor).toBe('page two/令牌')
  })

  it('returns an empty resource list without claiming a read failure', async () => {
    const h = await harness()
    h.server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [] }))
    await h.sync()
    expect((await h.execute('list')).content).toEqual([{ type: 'text', text: '{"resources":[]}' }])
  })

  it('rejects malformed resource metadata received from the server', async () => {
    const h = await harness()
    h.server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [{ name: 'missing-uri' }] }))
    await h.sync()
    expect((await h.execute('list')).isError).toBe(true)
  })

  it('rejects an empty model-supplied URI before reading from the server', async () => {
    const h = await harness()
    const read = vi.fn(() => ({ contents: [{ uri: 'docs:a', text: 'a' }] }))
    h.server.setRequestHandler(ReadResourceRequestSchema, read)
    await h.sync()
    expect((await h.execute('read', { uri: '' })).isError).toBe(true)
    expect(read).not.toHaveBeenCalled()
  })

  it('preserves resource identity and ordered text while omitting binary bytes from the canonical value', async () => {
    const h = await harness()
    const blob = Buffer.from('private binary payload').toString('base64')
    h.server.setRequestHandler(ReadResourceRequestSchema, request => ({ contents: [
      { uri: request.params.uri, mimeType: 'text/markdown', text: '# 说明\nfirst' },
      { uri: 'docs:image', mimeType: 'image/png', blob },
      { uri: 'docs:tail', text: 'last' },
    ] }))
    await h.sync()
    const result = await h.execute('read', { uri: 'docs:guide' })
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ contents: [
      { uri: 'docs:guide', mimeType: 'text/markdown', text: '# 说明\nfirst' },
      { uri: 'docs:image', mimeType: 'image/png', binary: true },
      { uri: 'docs:tail', text: 'last' },
    ] })
    expect(result.content).toEqual([{ type: 'text', text: [
      'Resource: docs:guide (text/markdown)\n# 说明\nfirst',
      'Resource: docs:image (image/png)\n[binary resource omitted; its bytes are not available in this result]',
      'Resource: docs:tail\nlast',
    ].join('\n\n') }])
    expect(JSON.stringify(result)).not.toContain(blob)
  })

  it('rejects a malformed remote resource response through the SDK schema', async () => {
    const h = await harness()
    h.server.setRequestHandler(ReadResourceRequestSchema, () => ({ contents: [{ uri: 'docs:a' }] }))
    await h.sync()
    expect((await h.execute('read', { uri: 'docs:a' })).isError).toBe(true)
  })

  it('reports an empty read response as a failed tool call', async () => {
    const h = await harness()
    h.server.setRequestHandler(ReadResourceRequestSchema, () => ({ contents: [] }))
    await h.sync()
    expect((await h.execute('read', { uri: 'docs:empty' })).content).toEqual([
      { type: 'text', text: 'Error: MCP resource docs:empty returned no content' },
    ])
  })

  it('enforces native pre-execution policy before sending resources/read', async () => {
    const h = await harness()
    const read = vi.fn(() => ({ contents: [{ uri: 'docs:a', text: 'secret' }] }))
    h.server.setRequestHandler(ReadResourceRequestSchema, read)
    await h.sync()
    h.ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'deny', reason: 'resource access denied' }))
    const result = await h.execute('read', { uri: 'docs:a' })
    expect(result.isError).toBe(true)
    expect(read).not.toHaveBeenCalled()
  })

  it('cancels an in-flight resource request through the MCP protocol', async () => {
    const h = await harness()
    const entered: PromiseWithResolvers<void> = Promise.withResolvers()
    const stopped: PromiseWithResolvers<void> = Promise.withResolvers()
    h.server.setRequestHandler(ReadResourceRequestSchema, async (_request, extra) => {
      entered.resolve()
      await new Promise<void>((resolve) => {
        extra.signal.addEventListener('abort', () => { stopped.resolve(); resolve() }, { once: true })
      })
      return { contents: [{ uri: 'docs:a', text: 'late' }] }
    })
    await h.sync()
    const abort = new AbortController()
    const result = h.execute('read', { uri: 'docs:a' }, abort.signal)
    await entered.promise
    abort.abort()
    expect((await result).isError).toBe(true)
    await stopped.promise
  })

  it('keeps resource registrations when a later remote tool listing fails', async () => {
    const h = await harness({ tools: {}, resources: {} })
    h.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }))
    await h.sync()
    h.server.setRequestHandler(ListToolsRequestSchema, () => { throw new Error('list failed') })
    await expect(h.sync()).rejects.toThrow('list failed')
    expect(h.ctx.tools.get('mcp_resource__docs__read')).toBeDefined()
  })
})
