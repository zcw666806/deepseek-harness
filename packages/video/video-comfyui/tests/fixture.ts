import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { ComfyWorkflow, Config } from '../src/types.ts'

export const mp4 = Buffer.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 1])
export const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC'

export function workflow(references = 0): ComfyWorkflow {
  return {
    id: 'owned', title: 'Owned workflow',
    template: { '1': { class_type: 'OperatorVideo', inputs: { text: '', seconds: 2, width: 854, height: 480, prefix: '', ...Object.fromEntries(Array.from({ length: references }, (_, index) => [`ref${index}`, ''])) } } },
    prompt: { node: '1', input: 'text' }, duration: { node: '1', input: 'seconds', unit: 'seconds' },
    width: { node: '1', input: 'width' }, height: { node: '1', input: 'height' },
    references: Array.from({ length: references }, (_, index) => ({ node: '1', input: `ref${index}` })),
    outputPrefix: { node: '1', input: 'prefix' }, durations: [2, 4],
    sizes: [{ aspectRatio: '16:9', resolution: '480p', width: 854, height: 480 }],
    output: { node: '1', key: 'images', index: 0 },
  }
}

export interface Submission {
  prompt_id: string
  client_id: string
  prompt: Record<string, { inputs: Record<string, unknown> }>
}

export function json(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
}

export async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const part of request) chunks.push(Buffer.from(part as Uint8Array))
  return Buffer.concat(chunks)
}

export async function fixture(
  override?: (request: IncomingMessage, response: ServerResponse, state: FixtureState) => Promise<boolean> | boolean,
) {
  const state: FixtureState = { requests: [], submissions: [], uploads: [], cancellations: [], status: 'completed' }
  const failures: unknown[] = []
  const handlers = new Set<Promise<void>>()
  const server = createServer((request, response) => {
    const handler = (async () => {
      state.requests.push({ url: request.url!, method: request.method!, authorization: request.headers.authorization })
      if (await override?.(request, response, state)) return
      const url = new URL(request.url!, 'http://fixture.invalid')
      if (url.pathname === '/prompt') {
        const value = JSON.parse((await body(request)).toString()) as Submission
        state.submissions.push(value)
        json(response, { prompt_id: value.prompt_id, number: 0, node_errors: {} })
      } else if (url.pathname.startsWith('/history/')) {
        const submission = state.submissions.find(item => item.prompt_id === url.pathname.split('/')[2])
        if (!submission || state.status !== 'completed') { json(response, {}); return }
        const folder = `dsh/${submission.prompt_id}`
        json(response, { [submission.prompt_id]: {
          prompt: [0, submission.prompt_id, submission.prompt, { client_id: submission.client_id }, ['1']],
          status: { status_str: 'success', completed: true, messages: [] },
          outputs: { '1': { images: [{ filename: 'video_00001_.mp4', subfolder: folder, type: 'output' }] } },
        } })
      } else if (url.pathname === '/view') {
        response.writeHead(200, { 'content-type': 'video/mp4' }).end(mp4)
      } else if (/^\/api\/jobs\/[^/]+\/cancel$/.test(url.pathname)) {
        state.cancellations.push(url.pathname.split('/')[3]!)
        const cancelled = state.status === 'pending' || state.status === 'in_progress'
        if (cancelled) state.status = 'cancelled'
        json(response, { cancelled })
      } else if (/^\/api\/jobs\/[^/]+$/.test(url.pathname)) {
        json(response, { id: url.pathname.split('/')[3], status: state.status })
      } else if (url.pathname === '/upload/image') {
        const raw = (await body(request)).toString('latin1')
        state.uploads.push(raw)
        const subfolder = /name="subfolder"\r\n\r\n([^\r]+)/.exec(raw)![1]!
        const name = /filename="([^"]+)"/.exec(raw)![1]!
        json(response, { name, subfolder, type: 'input' })
      } else { json(response, { error: 'Unexpected fixture endpoint' }, 404) }
    })().catch((error: unknown) => { failures.push(error); response.destroy(error instanceof Error ? error : undefined) })
    handlers.add(handler)
    void handler.finally(() => { handlers.delete(handler) })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  return {
    state, baseURL,
    config(patch: Partial<Config> = {}): Config {
      return { enabled: true, baseURL, workflows: [workflow()], pollIntervalMs: 1, cleanupTimeoutMs: 1000, ...patch }
    },
    async close() {
      const closed = new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
      server.closeAllConnections()
      await closed
      await Promise.all(handlers)
      if (failures.length) throw new AggregateError(failures, 'HTTP fixture handlers failed.')
    },
  }
}

export interface FixtureState {
  requests: { url: string; method: string; authorization: string | undefined }[]
  submissions: Submission[]
  uploads: string[]
  cancellations: string[]
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
}
