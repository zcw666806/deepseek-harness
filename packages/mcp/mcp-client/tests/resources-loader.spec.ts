/** Resource-only MCP activation through a real Cordis configuration and stdio server. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'

let root: string | undefined
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('MCP resources Loader composition', () => {
  it('loads a resource-only server, reads its contents, and removes registrations on disposal', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-mcp-resources-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-mcp-client'",
      `  config: ${JSON.stringify({
        serverName: 'docs', transport: 'stdio', command: process.execPath,
        args: [fileURLToPath(new URL('./resource-server.ts', import.meta.url))],
        failOnStartupError: true,
      })}`,
      '',
    ].join('\n'))
    ctx = new Context()
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-mcp-client', McpClient],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    const tools = ctx.get('tools')
    expect(tools).toBeDefined()
    if (tools === undefined) throw new Error('Loader did not activate the tool registry')
    expect(tools.schemas().map(tool => tool.name)).toEqual(['mcp_resource__docs__list', 'mcp_resource__docs__read'])
    const result = await tools.execute({
      callId: ToolCallId('loader-resource-read'), name: 'mcp_resource__docs__read',
      arguments: { uri: 'docs:guide' }, signal: new AbortController().signal,
    })
    expect(result.content).toEqual([
      { type: 'text', text: 'Resource: docs:guide (text/markdown)\n# Resource guide\nResources are fetched on demand.' },
    ])
    expect(result.isError).toBe(false)
    await ctx.fiber.dispose()
    ctx = undefined
    expect(tools.schemas()).toEqual([])
  })
})
