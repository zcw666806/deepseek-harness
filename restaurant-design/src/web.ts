/** Authenticated browser access to the configured restaurant workspace. */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from './service.ts'
import { ProjectError } from './project.ts'
import { renderPage } from './page.ts'
import { renderWorkbench } from './workbench.ts'

export const name = 'restaurant-web'
export const inject = ['connection', 'restaurantProject']

/** Browser synchronization policy. */
export interface Config {
  /** Poll interval while the page has no local edits in flight. */
  pollIntervalMs: number
}

/** Validate the explicit synchronization interval. */
export const Config: Schema<Config> = Schema.object({
  pollIntervalMs: Schema.number().min(250).required(),
})

/**
 * Parse a browser-operation object before dispatching to the project writer.
 * @param value - decoded request payload.
 * @returns the record carrying the operation fields.
 */
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('restaurant request must be an object')
  }
  return value as Record<string, unknown>
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('expectedRevision must be an integer')
  return value
}

function number(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be finite`)
  return value
}

function proposalId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('proposalId must be a non-empty string')
  return value
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error('itemIds must be an array of strings')
  }
  return value
}

/**
 * Register authenticated project reads and the fixed restaurant RPC operations.
 * @param ctx - Connection and project owner.
 * @param config - browser synchronization interval.
 */
export function apply(ctx: Context, config: Config): void {
  const { store, sourceHtml } = ctx.restaurantProject
  const snapshot = () => ({
    project: store.read(), selection: store.getSelection(), issues: store.check(),
    history: store.historyState(), proposal: store.getProposal(),
  })
  ctx.connection.fetch.register({
    path: '/api/restaurant.workbench', methods: ['GET', 'HEAD'], requestBody: 'buffered',
    fetch: async request => new Response(request.method === 'HEAD' ? null : renderWorkbench(), { headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
      'x-content-type-options': 'nosniff',
    } }),
  })
  ctx.connection.fetch.register({
    path: '/api/restaurant.page', methods: ['GET', 'HEAD'], requestBody: 'buffered',
    fetch: async request => {
      const params = new URL(request.url).searchParams
      const view = params.get('view')
      return new Response(request.method === 'HEAD' ? null : renderPage(sourceHtml, {
        project: store.read(), pollIntervalMs: config.pollIntervalMs,
        embedded: params.get('embedded') === '1',
        ...(view === 'plan' || view === 'scene' ? { view } : {}),
      }), { headers: {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'self'; frame-src 'self' blob:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; object-src 'none'",
        'x-content-type-options': 'nosniff',
      } })
    },
  })
  ctx.connection.fetch.register({
    path: '/api/restaurant.state', methods: ['GET'], requestBody: 'buffered',
    fetch: async () => Response.json(snapshot(), { headers: { 'cache-control': 'no-store' } }),
  })
  ctx.connection.fetch.register({
    path: '/api/restaurant.export', methods: ['GET', 'HEAD'], requestBody: 'buffered',
    fetch: async request => new Response(request.method === 'HEAD' ? null : JSON.stringify(store.read(), null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        'content-disposition': 'attachment; filename="restaurant-project.json"',
      },
    }),
  })
  ctx.connection.rpc.handle('/restaurant-rpc', async (endpoint, payload, signal) => {
    signal.throwIfAborted()
    try {
      const data = record(payload)
      if (endpoint === 'applyProposal') {
        store.applyProposal(proposalId(data.proposalId))
        return { ok: true, value: snapshot() }
      }
      if (endpoint === 'cancelProposal') {
        store.cancelProposal(proposalId(data.proposalId))
        return { ok: true, value: snapshot() }
      }
      if (endpoint !== 'select' && store.getProposal() !== null) {
        throw new ProjectError('PREVIEW_ACTIVE', 'Apply or cancel the replacement preview before editing the layout.')
      }
      switch (endpoint) {
        case 'select': store.select(ids(data.itemIds)); break
        case 'group': {
          if (typeof data.name !== 'string') throw new Error('group name must be a string')
          store.group(integer(data.expectedRevision), data.name, ids(data.itemIds)); break
        }
        case 'move': store.move(integer(data.expectedRevision), ids(data.itemIds),
          number(data.dxMm, 'dxMm'), number(data.dyMm, 'dyMm')); break
        case 'save': store.replaceState(integer(data.expectedRevision), data.state); break
        case 'undo': store.undo(integer(data.expectedRevision)); break
        case 'redo': store.redo(integer(data.expectedRevision)); break
        default: return { ok: false, error: { code: 'restaurant/unknown-operation', message: 'Unknown restaurant operation', details: {} } }
      }
      return { ok: true, value: snapshot() }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error instanceof ProjectError ? error.code : 'restaurant/invalid-operation',
          message: error instanceof Error ? error.message : String(error),
          details: error instanceof ProjectError ? { issues: error.issues ?? [] } : {},
        },
      }
    }
  })
}
