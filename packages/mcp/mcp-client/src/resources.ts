/** On-demand MCP resource tools; binary payloads never enter canonical values or model history. */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolBridgeOptions } from './tools.ts'

/** Resource metadata retained from the remote server's validated listing. */
interface ResourceEntry {
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  size?: number
}

/** One resource listing page; cursors remain opaque server-issued strings. */
interface ResourcePage {
  resources: ResourceEntry[]
  nextCursor?: string
}

/** Text content or an explicit binary omission, without the wire base64. */
interface ResourceContent {
  uri: string
  mimeType?: string
  text?: string
  binary?: boolean
}

/**
 * Build resource operations when the connected server advertises resources.
 * The separate prefix cannot collide with server-provided `mcp__` tool names.
 * @param client - connected SDK client; its response schemas validate remote JSON.
 * @param opts - server namespace and per-request timeout.
 * @returns list and read definitions, or none when resources are not advertised.
 */
export function resourceDefinitions(client: Client, opts: ToolBridgeOptions): ToolDefinition[] {
  if (client.getServerCapabilities()?.resources === undefined) return []
  const prefix = `mcp_resource__${opts.serverName}__`
  return [
    defineTool({
      name: `${prefix}list`,
      description: `List one page of resources from MCP server ${opts.serverName}, without their contents. `
        + `Pass nextCursor as cursor to continue. Read a listed URI with ${prefix}read.`,
      parameters: {
        cursor: { type: 'string', description: 'Opaque nextCursor from the previous page; omit for the first page.' },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            resources: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                properties: {
                  uri: { type: 'string', required: true }, name: { type: 'string', required: true }, title: { type: 'string' },
                  description: { type: 'string' }, mimeType: { type: 'string' }, size: { type: 'number' },
                },
                additionalProperties: false,
              },
            },
            nextCursor: { type: 'string' },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec): Promise<ResourcePage> {
        const { cursor } = args
        const response = await client.listResources(cursor === undefined ? {} : { cursor }, {
          signal: exec.signal, timeout: opts.toolCallTimeoutMs,
        })
        return {
          resources: response.resources.map(({ uri, name, title, description, mimeType, size }) => ({
            uri, name,
            ...title === undefined ? {} : { title },
            ...description === undefined ? {} : { description },
            ...mimeType === undefined ? {} : { mimeType },
            ...size === undefined ? {} : { size },
          })),
          ...response.nextCursor === undefined ? {} : { nextCursor: response.nextCursor },
        }
      },
      presentCall: () => ({ card: 'generic', title: `${opts.serverName}: resources`, kind: 'read' }),
    }),
    defineTool({
      name: `${prefix}read`,
      description: `Read a resource URI from MCP server ${opts.serverName}. `
        + `Use ${prefix}list to discover URIs. Text is returned on demand; binary content is identified but not included.`,
      parameters: {
        uri: { type: 'string', required: true, description: 'Non-empty resource URI provided by this MCP server.' },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            contents: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                properties: {
                  uri: { type: 'string', required: true }, mimeType: { type: 'string' },
                  text: { type: 'string' }, binary: { type: 'boolean' },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.contents.map(content =>
            `Resource: ${content.uri}${content.mimeType === undefined ? '' : ` (${content.mimeType})`}\n`
            + (content.text ?? '[binary resource omitted; its bytes are not available in this result]'),
          ).join('\n\n'),
        }],
      },
      async execute(args, exec): Promise<{ contents: ResourceContent[] }> {
        const { uri } = args
        if (uri.length === 0) throw new Error('MCP resource URI must not be empty')
        const response = await client.readResource({ uri }, { signal: exec.signal, timeout: opts.toolCallTimeoutMs })
        if (response.contents.length === 0) throw new Error(`MCP resource ${uri} returned no content`)
        return {
          contents: response.contents.map(content => ({
            uri: content.uri,
            ...content.mimeType === undefined ? {} : { mimeType: content.mimeType },
            ...'text' in content ? { text: content.text } : { binary: true },
          })),
        }
      },
      presentCall: args => ({ card: 'generic', title: `${opts.serverName}: resource`, kind: 'read', rawInput: args }),
    }),
  ]
}
