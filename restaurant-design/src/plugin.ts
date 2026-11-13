/** Model-facing operations for one explicitly configured restaurant project. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from './service.ts'
import { ProjectError } from './project.ts'
import type { DiningProposal } from './types.ts'

export const name = 'restaurant-tools'
export const inject = ['tools', 'restaurantProject']

const ids = {
  type: 'array', required: true, items: { type: 'string' },
  description: 'Explicit furniture or group IDs returned by restaurant_read.',
} as const
const revision = {
  type: 'integer', required: true,
  description: 'Current project revision returned by restaurant_read; stale revisions are rejected.',
} as const
const output = {
  schema: { type: 'json' },
  render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const

/**
 * Detach the imported project's JSON fields for a canonical tool result.
 * @param value - JSON-only project or check result.
 * @returns the serialized project value, including preserved imported metadata.
 */
function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

interface SubmittedSelection {
  readonly revision: number
  readonly itemIds: readonly string[]
  readonly groupId: string | undefined
}

function previewResult(proposal: DiningProposal): JsonValue {
  const itemName = (id: string) => proposal.addedItems.find(item => item.id === id)?.name ?? id
  return json({
    ok: true,
    preview: {
      baseRevision: proposal.baseRevision,
      groupId: proposal.groupId,
      beforeSeats: proposal.beforeSeats,
      afterSeats: proposal.afterSeats,
      template: proposal.template,
      canApply: proposal.canApply,
      issues: proposal.issues.map(issue => ({
        kind: issue.kind,
        items: issue.itemIds.map(itemName),
        ...(issue.obstacleId === undefined ? {} : { obstacle: itemName(issue.obstacleId) }),
        overlapMm: issue.overlapMm,
      })),
    },
  })
}

/**
 * Register layout tools on the current Harness tool registry.
 * @param ctx - tools and configured project owner.
 */
export function apply(ctx: Context): void {
  const store = ctx.restaurantProject.store
  const pending = new WeakMap<Agent, Map<MessageId, SubmittedSelection>>()
  const claimed = new WeakMap<Agent, SubmittedSelection>()
  const selectionFor = (agent: Agent | undefined) => agent === undefined ? undefined : claimed.get(agent)
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (message.source.kind !== 'user') return
    const project = store.read()
    const itemIds = store.getSelection()
    const group = project.groups.find(candidate => candidate.itemIds.length === itemIds.length
      && candidate.itemIds.every(id => itemIds.includes(id)))
    let selections = pending.get(agent)
    if (selections === undefined) {
      selections = new Map()
      pending.set(agent, selections)
    }
    selections.set(message.id, { revision: project.revision, itemIds, groupId: group?.id })
  })
  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message.source.kind !== 'user') return
    const selections = pending.get(agent)
    const selection = selections?.get(message.id)
    selections?.delete(message.id)
    if (selection === undefined) claimed.delete(agent)
    else claimed.set(agent, selection)
  })
  ctx.on('agent/inbox/discarded', ({ agent, message }) => pending.get(agent)?.delete(message.id))
  ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') claimed.delete(agent) })

  const snapshot = (submitted?: SubmittedSelection): JsonValue => json({
    ok: true,
    project: store.read(), selection: submitted?.itemIds ?? store.getSelection(), issues: store.check(),
    ...(submitted?.itemIds.length ? { selectionRevision: submitted.revision, selectedGroupId: submitted.groupId ?? null } : {}),
    history: store.historyState(),
    pagePath: '/api/restaurant.page',
  })
  const rejection = (error: unknown): JsonValue => {
    if (!(error instanceof ProjectError)) throw error
    return json({
      ok: false, revision: store.read().revision,
      error: { code: error.code, message: error.message, issues: error.issues ?? [] },
    })
  }
  const change = (operation: () => unknown): JsonValue => {
    try {
      operation()
      return snapshot()
    } catch (error) {
      return rejection(error)
    }
  }
  ctx.tools.register(defineTool({
    name: 'restaurant_read',
    description: 'Read the configured restaurant layout, selected furniture, explicit groups, '
      + 'revision and existing spatial conflicts. Read before modifying; use exact IDs and millimetres. '
      + 'Dimensions are imported or provisional, not a structural or fire-safety assessment.',
    parameters: {}, output,
    execute: async (_args, exec) => { exec.signal.throwIfAborted(); return snapshot(selectionFor(exec.agent)) },
    presentCall: () => ({ card: 'generic', title: 'Read restaurant layout', kind: 'read' }),
  }))
  ctx.tools.register(defineTool({
    name: 'restaurant_group',
    description: 'Create an explicitly named group from furniture IDs, such as one table and its '
      + 'chairs. Use the user selection or confirmed IDs; do not infer membership from proximity.',
    parameters: { expectedRevision: revision, name: { type: 'string', required: true }, itemIds: ids },
    output,
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      return change(() => store.group(args.expectedRevision, args.name, args.itemIds))
    },
    presentCall: () => ({ card: 'generic', title: 'Group restaurant furniture' }),
  }))
  ctx.tools.register(defineTool({
    name: 'restaurant_move',
    description: 'Translate explicit furniture or group IDs by dxMm and dyMm in the plan coordinates '
      + '(right and down respectively). Checks the complete candidate layout, refuses new or worsened '
      + 'collisions, and persists one undoable revision. Walls and openings remain fixed.',
    parameters: {
      expectedRevision: revision, itemIds: ids,
      dxMm: { type: 'number', required: true }, dyMm: { type: 'number', required: true },
    },
    output,
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      return change(() => store.move(args.expectedRevision, args.itemIds, args.dxMm, args.dyMm))
    },
    presentCall: () => ({ card: 'generic', title: 'Move restaurant furniture' }),
  }))
  ctx.tools.register(defineTool({
    name: 'restaurant_preview_four_seat',
    description: 'Preview replacing one group containing a table and two chairs with the four-seat template. '
      + 'Read the project first. For the selected group, use the selection from the user’s submitted message. '
      + 'Use groupId only for an explicit group or the selectedGroupId returned by restaurant_read. '
      + 'The preview checks furniture and chair pull-out space without saving. The user confirms in the workbench.',
    parameters: {
      expectedRevision: revision,
      groupId: { type: 'string', description: 'Exact group ID when explicitly identified. Omit to use the group selected at submission.' },
    },
    output,
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      try {
        const selection = selectionFor(exec.agent)
        if (args.groupId === undefined && selection?.groupId === undefined) {
          throw new ProjectError('GROUP_REQUIRED', 'Select one complete two-seat group before sending the request, or identify its group ID.')
        }
        const useSelection = selection?.groupId !== undefined
          && (args.groupId === undefined || args.groupId === selection.groupId)
        if (useSelection && args.expectedRevision !== selection.revision) {
          throw new ProjectError('REVISION_CONFLICT', 'The project changed after submission. Select the group and send a new request.')
        }
        const groupId = useSelection ? selection.groupId : args.groupId
        return previewResult(store.proposeFourSeat(args.expectedRevision, groupId))
      } catch (error) {
        return rejection(error)
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Preview four-seat replacement' }),
  }))
  ctx.tools.register(defineTool({
    name: 'restaurant_check',
    description: 'Report current furniture, wall, door-swing and configured keepout conflicts. '
      + 'This checks project layout rules; it does not certify egress, capacity or construction.',
    parameters: {}, output,
    execute: async (_args, exec) => {
      exec.signal.throwIfAborted()
      return json({ revision: store.read().revision, issues: store.check() })
    },
    presentCall: () => ({ card: 'generic', title: 'Check restaurant layout' }),
  }))
  ctx.tools.register(defineTool({
    name: 'restaurant_undo',
    description: 'Undo the last restaurant project change, including mouse or assistant changes. '
      + 'The restored layout receives a new revision number.',
    parameters: { expectedRevision: revision }, output,
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      return change(() => store.undo(args.expectedRevision))
    },
    presentCall: () => ({ card: 'generic', title: 'Undo restaurant change' }),
  }))
  ctx.tools.register(defineTool({
    name: 'restaurant_redo',
    description: 'Redo an undone restaurant change at the current project revision.',
    parameters: { expectedRevision: revision }, output,
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      return change(() => store.redo(args.expectedRevision))
    },
    presentCall: () => ({ card: 'generic', title: 'Redo restaurant change' }),
  }))
}
