/** The real Loader, tool registry and project writer share one restaurant state. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as RestaurantProject from '../src/service.ts'
import * as RestaurantTools from '../src/plugin.ts'

let directory: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

function sourcePage(): string {
  const furniture = [
    { id: 'table-1', type: 'table', name: 'Table', cx: 2000, cy: 2000, w: 1000, d: 600, rot: 0, color: '#cccccc' },
    { id: 'chair-1', type: 'chair', name: 'Chair', cx: 3000, cy: 2000, w: 400, d: 400, rot: 0, color: '#aaaaaa' },
    { id: 'chair-2', type: 'chair', name: 'Chair', cx: 2000, cy: 2600, w: 400, d: 400, rot: 0, color: '#aaaaaa' },
  ]
  return [
    '<!doctype html><title>Restaurant fixture</title><script>',
    'const WALLS = [];', 'const WINS = [];', 'const DOORS = [];',
    'const SLIDES = [];', 'const ROOMS = [];',
    'const BOUNDS = {"x":0,"y":0,"w":10000,"h":8000};',
    `let state = ${JSON.stringify({ furniture, rooms: {}, demolished: [], measures: [] })};`,
    '</script>',
  ].join('\n')
}

function owner(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('restaurant-loader-owner')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

async function boot(): Promise<{ ctx: Context; projectPath: string }> {
  directory = await mkdtemp(join(tmpdir(), 'dsh-restaurant-loader-'))
  const sourcePath = join(directory, 'restaurant.html')
  const projectPath = join(directory, 'project.json')
  const configPath = join(directory, 'cordis.yml')
  await writeFile(sourcePath, sourcePage())
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: 'restaurant-project'",
    '  config:',
    `    sourceHtml: ${JSON.stringify(sourcePath)}`,
    `    projectPath: ${JSON.stringify(projectPath)}`,
    "- name: 'restaurant-tools'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['restaurant-project', RestaurantProject],
    ['restaurant-tools', RestaurantTools],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected restaurant Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { ctx, projectPath }
}

function invoke(ctx: Context, agent: Agent, name: string, args: Record<string, unknown>) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(randomUUID()), name, arguments: args, agent,
  })
}

describe('restaurant workspace Loader composition', () => {
  it('groups, moves and restores furniture through the registered tools and durable writer', async () => {
    const { ctx, projectPath } = await boot()
    const agent = owner(ctx)
    const read = await invoke(ctx, agent, 'restaurant_read', {})
    expect(read.isError).toBe(false)
    expect(read.value).toMatchObject({ project: { revision: 0 }, selection: [], issues: [] })

    const group = await invoke(ctx, agent, 'restaurant_group', {
      expectedRevision: 0, name: 'Window table', itemIds: ['table-1', 'chair-1'],
    })
    expect(group.isError).toBe(false)
    const groupId = ctx.restaurantProject.store.read().groups[0]!.id
    const moved = await invoke(ctx, agent, 'restaurant_move', {
      expectedRevision: 1, itemIds: [groupId], dxMm: 300, dyMm: 0,
    })
    expect(moved.isError).toBe(false)
    expect(moved.value).toMatchObject({ project: { revision: 2 } })
    expect(moved.value).toMatchObject({ history: { canUndo: true, canRedo: false } })
    const persisted = JSON.parse(await readFile(projectPath, 'utf8')) as {
      state: { furniture: { id: string; cx: number }[] }
    }
    expect(persisted.state.furniture.map(item => [item.id, item.cx])).toEqual([
      ['table-1', 2300], ['chair-1', 3300], ['chair-2', 2000],
    ])

    const undo = await invoke(ctx, agent, 'restaurant_undo', { expectedRevision: 2 })
    expect(undo.isError).toBe(false)
    expect(undo.value).toMatchObject({ project: { revision: 3 } })
    expect(undo.value).toMatchObject({ history: { canUndo: true, canRedo: true } })
    expect(ctx.restaurantProject.store.read().state.furniture.map(item => item.cx)).toEqual([2000, 3000, 2000])
    const restored = JSON.parse(await readFile(projectPath, 'utf8')) as { revision: number }
    expect(restored.revision).toBe(3)
  })

  it('refuses a stale tool change without altering the durable project', async () => {
    const { ctx, projectPath } = await boot()
    const agent = owner(ctx)
    const accepted = await invoke(ctx, agent, 'restaurant_move', {
      expectedRevision: 0, itemIds: ['table-1'], dxMm: 100, dyMm: 0,
    })
    expect(accepted.isError).toBe(false)
    const before = await readFile(projectPath, 'utf8')
    const rejected = await invoke(ctx, agent, 'restaurant_move', {
      expectedRevision: 0, itemIds: ['table-1'], dxMm: 200, dyMm: 0,
    })
    expect(rejected.isError).toBe(false)
    expect(rejected.value).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } })
    expect(await readFile(projectPath, 'utf8')).toBe(before)
  })

  it('previews the group selected at submission after the browser selection changes', async () => {
    const { ctx, projectPath } = await boot()
    const agent = owner(ctx)
    const store = ctx.restaurantProject.store
    const grouped = store.group(0, 'Window table', ['table-1', 'chair-1', 'chair-2'])
    const groupId = grouped.groups[0]!.id
    store.select([groupId])
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Preview four seats here' }] })
    ctx.emit('agent/inbox/inserted', { agent, message })
    store.select([])
    ctx.emit('agent/inbox/claimed', { agent, message, turn: 1 })

    const before = await readFile(projectPath, 'utf8')
    const read = await invoke(ctx, agent, 'restaurant_read', {})
    expect(read.value).toMatchObject({ selection: ['table-1', 'chair-1', 'chair-2'], selectionRevision: 1, selectedGroupId: groupId })
    const preview = await invoke(ctx, agent, 'restaurant_preview_four_seat', { expectedRevision: 1 })
    expect(preview.value).toMatchObject({ ok: true, preview: { groupId, baseRevision: 1, canApply: true, beforeSeats: 2, afterSeats: 4 } })
    expect(await readFile(projectPath, 'utf8')).toBe(before)
    expect(ctx.tools.schemas().some(schema => schema.name.includes('applyProposal'))).toBe(false)
  })

  it('withdraws the restaurant tools when their owning composition is disposed', async () => {
    const { ctx } = await boot()
    const tools = ctx.tools
    expect(tools.schemas().filter(schema => schema.name.startsWith('restaurant_'))).toHaveLength(7)
    await ctx.fiber.dispose()
    context = undefined
    expect(tools.schemas().some(schema => schema.name.startsWith('restaurant_'))).toBe(false)
  })
})
