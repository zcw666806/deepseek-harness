/** Resource-only stdio server mounted beside the shipped headless composition. */

import { fileURLToPath } from 'node:url'

/** Cordis fixture plugin name. */
export const name = 'mcp-resource-fixture'

/**
 * Await real MCP activation before the first model request.
 * @param ctx - plugin context owning the MCP child fiber.
 */
export async function apply(ctx) {
  // Snapshots are outside the package's dependency tree; match the dsh launcher's source or built entry.
  const entry = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/index.js' : 'src/index.ts'
  const McpClient = await import(new URL(`../../../packages/mcp/mcp-client/${entry}`, import.meta.url).href)
  await ctx.plugin(McpClient, {
    transport: 'stdio',
    serverName: 'docs',
    command: process.execPath,
    args: [fileURLToPath(new URL('../../../packages/mcp/mcp-client/tests/resource-server.ts', import.meta.url))],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 60_000,
    failOnStartupError: true,
    reconnect: { enabled: false },
  })
}
