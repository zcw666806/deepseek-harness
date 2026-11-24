import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { VideoGenerationInput, VideoGenerationResult } from '@deepseek-ai/dsh-video-production/types'
import { resolveConfig } from '../src/config.ts'
import { generateComfyVideo } from '../src/provider.ts'
import { body, fixture, imageData, json, mp4, workflow, type FixtureState, type Submission } from './fixture.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) await dispose() })

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-comfyui-provider-'))
  const ctx = new Context()
  const operations: Promise<VideoGenerationResult>[] = []
  const controllers: AbortController[] = []
  cleanups.push(async () => {
    for (const controller of controllers) controller.abort(new Error('Test teardown'))
    await Promise.allSettled(operations)
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(LocalAttachmentStore, { dshHome: root })
  return {
    ctx,
    start(config: Parameters<typeof resolveConfig>[0], patch: Partial<VideoGenerationInput> = {}) {
      const controller = new AbortController()
      controllers.push(controller)
      const operation = generateComfyVideo(ctx.attachments, resolveConfig(config), {
        sessionId: SessionId('comfyui-test'), prompt: 'Two friends wave.', duration: 2,
        aspectRatio: '16:9', resolution: '480p', referenceImages: [], model: 'owned', ...patch,
      }, controller.signal)
      operations.push(operation)
      void operation.catch(() => {})
      return { controller, operation }
    },
  }
}

async function server(override?: Parameters<typeof fixture>[0]) {
  const result = await fixture(override)
  cleanups.push(() => result.close())
  return result
}

function history(state: FixtureState, output: unknown, status: unknown = { status_str: 'success', completed: true, messages: [] }): unknown {
  const submission = state.submissions[0]!
  return { [submission.prompt_id]: {
    prompt: [0, submission.prompt_id, submission.prompt, { client_id: submission.client_id }, ['1']],
    status, outputs: { '1': { images: [output] } },
  } }
}

describe('ComfyUI fixed-endpoint video protocol', () => {
  it('submits explicit scalar values once, preserves reference order and saves only the configured video', async () => {
    const http = await server()
    const app = await setup()
    const image = await app.ctx.attachments.saveImage({ data: Buffer.from(imageData, 'base64'), mediaType: 'image/png' })
    const secondData = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWP4lWL0K8WIAUIBAC7uBkFP2lNsAAAAAElFTkSuQmCC'
    const second = await app.ctx.attachments.saveImage({ data: Buffer.from(secondData, 'base64'), mediaType: 'image/png' })
    const config = http.config({ headers: { authorization: 'Bearer fixture-secret' }, workflows: [{ ...workflow(2), duration: { ...workflow().duration, unit: 'frames', fps: 20, frameOffset: 1 } }] })
    const result = await app.start(config, { referenceImages: [second, image] }).operation
    expect(Buffer.from((await app.ctx.attachments.readVideo(result.attachment)).data)).toEqual(mp4)
    expect(result.attachment.durationSeconds).toBeUndefined()
    expect(http.state.submissions).toHaveLength(1)
    const submission = http.state.submissions[0]!
    expect(submission.prompt['1']!.inputs).toMatchObject({
      text: 'Two friends wave.', seconds: 41, width: 854, height: 480,
      ref0: `dsh/${submission.prompt_id}/reference-0.png`, ref1: `dsh/${submission.prompt_id}/reference-1.png`, prefix: `dsh/${submission.prompt_id}/video`,
    })
    expect(http.state.uploads).toHaveLength(2)
    expect(http.state.uploads[0]).toContain(Buffer.from((await app.ctx.attachments.readImage(second)).data).toString('latin1'))
    expect(http.state.uploads[1]).toContain(Buffer.from((await app.ctx.attachments.readImage(image)).data).toString('latin1'))
    for (const upload of http.state.uploads) expect(upload).toContain('name="overwrite"\r\n\r\nfalse')
    expect(http.state.requests.every(request => request.authorization === 'Bearer fixture-secret')).toBe(true)
    expect(http.state.cancellations).toEqual([])
  })

  it('rejects incompatible exact reference counts and size pairs before any request', async () => {
    const http = await server()
    const app = await setup()
    await expect(app.start(http.config({ workflows: [workflow(1)] })).operation).rejects.toThrow('exact reference-image count')
    await expect(app.start(http.config(), { aspectRatio: '9:16' }).operation).rejects.toThrow('dimensions')
    expect(http.state.requests).toEqual([])
  })

  it.each(['/', '\\'])('accepts its own output using server directory separator %j', async (separator) => {
    const http = await server((request, response, state) => {
      if (!request.url!.startsWith('/history/')) return false
      const ownId = state.submissions[0]!.prompt_id
      json(response, history(state, { filename: 'video.mp4', subfolder: `dsh${separator}${ownId}`, type: 'output' }))
      return true
    })
    const app = await setup()
    const result = await app.start(http.config()).operation
    expect(Buffer.from((await app.ctx.attachments.readVideo(result.attachment)).data)).toEqual(mp4)
    const download = http.state.requests.find(request => request.url.startsWith('/view'))!
    expect(new URL(download.url, http.baseURL).searchParams.get('subfolder')).toBe(`dsh/${http.state.submissions[0]!.prompt_id}`)
  })

  it('rejects traversal after normalizing Windows output separators', async () => {
    const http = await server((request, response, state) => {
      if (!request.url!.startsWith('/history/')) return false
      json(response, history(state, { filename: 'video.mp4', subfolder: `dsh\\${state.submissions[0]!.prompt_id}\\..\\other`, type: 'output' }))
      return true
    })
    const app = await setup()
    await expect(app.start(http.config()).operation).rejects.toThrow('safe relative path')
    expect(http.state.requests.some(request => request.url.startsWith('/view'))).toBe(false)
  })

  it.each([
    { filename: '../other.mp4', subfolder: 'own', type: 'output' },
    { filename: 'video.mp4 [input]', subfolder: 'own', type: 'output' },
    { filename: 'video.mp4', subfolder: '../elsewhere', type: 'output' },
    { filename: 'video.mp4', subfolder: 'another-job', type: 'output' },
    { filename: 'video.mp4', subfolder: 'own', type: 'input' },
    { filename: 'blake3:abcd', subfolder: '', type: 'output' },
  ])('rejects non-owned output paths without downloading: %j', async (output) => {
    const http = await server((request, response, state) => {
      if (!request.url!.startsWith('/history/')) return false
      json(response, history(state, output))
      return true
    })
    const app = await setup()
    await expect(app.start(http.config()).operation).rejects.toThrow()
    expect(http.state.requests.some(request => request.url.startsWith('/view'))).toBe(false)
    expect(http.state.cancellations).toEqual([])
  })

  it('rejects failed terminal history even when output metadata is present', async () => {
    const http = await server((request, response, state) => {
      if (!request.url!.startsWith('/history/')) return false
      json(response, history(state, {}, { status_str: 'error', completed: false, messages: [['execution_error', { exception_message: 'node failed' }]] }))
      return true
    })
    const app = await setup()
    await expect(app.start(http.config()).operation).rejects.toThrow('failed or was interrupted')
    expect(http.state.cancellations).toEqual([])
    expect(http.state.requests.some(request => request.url.startsWith('/view'))).toBe(false)
  })

  it('refuses output redirects without sending configured headers to another origin', async () => {
    const target = await server()
    const http = await server((request, response) => {
      if (!request.url!.startsWith('/view')) return false
      response.writeHead(302, { location: `${target.baseURL}stolen` }).end()
      return true
    })
    const app = await setup()
    await expect(app.start(http.config({ headers: { authorization: 'Bearer private' } })).operation).rejects.toThrow()
    expect(target.state.requests).toEqual([])
  })

  it.each(['length', 'stream', 'magic'] as const)('bounds downloads and verifies video bytes: %s', async (mode) => {
    const http = await server((request, response) => {
      if (!request.url!.startsWith('/view')) return false
      if (mode === 'length') response.writeHead(200, { 'content-length': 1000 }).end(mp4)
      else if (mode === 'stream') { response.writeHead(200); response.write(mp4); response.end(mp4) }
      else response.end('not video')
      return true
    })
    const app = await setup()
    await expect(app.start(http.config({ maxVideoBytes: mode === 'magic' ? 1000 : mp4.length })).operation).rejects.toThrow(mode === 'magic' ? 'do not match' : 'byte limit')
  })

  it('waits for a delayed submission acknowledgment before cancelling only its own job', async () => {
    const received = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const http = await server(async (request, response, state) => {
      if (request.url !== '/prompt') return false
      state.submissions.push(JSON.parse((await body(request)).toString()) as Submission)
      state.status = 'in_progress'
      received.resolve(undefined)
      await release.promise
      json(response, { prompt_id: state.submissions[0]!.prompt_id, number: 0 })
      return true
    })
    const app = await setup()
    const run = app.start(http.config())
    cleanups.push(async () => { release.resolve(undefined) })
    await received.promise
    run.controller.abort(new Error('Stopped by user'))
    expect(http.state.cancellations).toEqual([])
    release.resolve(undefined)
    await expect(run.operation).rejects.toThrow('Stopped by user')
    expect(http.state.submissions).toHaveLength(1)
    expect(http.state.cancellations).toEqual([http.state.submissions[0]!.prompt_id])
    expect(http.state.requests.some(request => request.url === '/interrupt' || request.url === '/queue')).toBe(false)
  })

  it('does not retry an unacknowledged submission and cancels its preallocated identity', async () => {
    const http = await server(async (request, response, state) => {
      if (request.url !== '/prompt') return false
      state.submissions.push(JSON.parse((await body(request)).toString()) as Submission)
      state.status = 'pending'
      response.destroy()
      return true
    })
    const app = await setup()
    await expect(app.start(http.config()).operation).rejects.toThrow()
    expect(http.state.submissions).toHaveLength(1)
    expect(http.state.cancellations).toEqual([http.state.submissions[0]!.prompt_id])
  })

  it('reports unconfirmed remote cancellation when the reviewed job endpoint is unavailable', async () => {
    const polled = Promise.withResolvers<undefined>()
    const http = await server((request, response, state) => {
      if (request.url === '/prompt') { state.status = 'in_progress'; return false }
      if (request.url!.startsWith('/history/')) { polled.resolve(undefined); json(response, {}); return true }
      if (request.url!.endsWith('/cancel')) { json(response, {}, 404); return true }
      return false
    })
    const app = await setup()
    const run = app.start(http.config())
    await polled.promise
    run.controller.abort(new Error('Stop'))
    await expect(run.operation).rejects.toThrow('remote termination is unconfirmed')
    expect(http.state.requests.filter(request => request.url === '/interrupt')).toEqual([])
  })

  it('selects the configured history key and index without scanning other outputs', async () => {
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0])
    const http = await server((request, response, state) => {
      if (request.url!.startsWith('/view')) { response.end(webm); return true }
      if (!request.url!.startsWith('/history/')) return false
      const submission = state.submissions[0]!
      const value = history(state, {}) as Record<string, { outputs: unknown }>
      value[submission.prompt_id]!.outputs = {
        unrelated: { images: [{ filename: 'other.mp4', subfolder: 'another-job', type: 'output' }] },
        '1': { clips: [{ filename: '../ignored.mp4', type: 'input' }, { filename: 'chosen.webm', subfolder: `dsh/${submission.prompt_id}`, type: 'output' }] },
      }
      json(response, value)
      return true
    })
    const app = await setup()
    const result = await app.start(http.config({ workflows: [{ ...workflow(), output: { node: '1', key: 'clips', index: 1 } }] })).operation
    expect(Buffer.from((await app.ctx.attachments.readVideo(result.attachment)).data)).toEqual(webm)
    const requested = new URL(http.state.requests.find(request => request.url.startsWith('/view'))!.url, http.baseURL)
    expect(requested.searchParams.get('filename')).toBe('chosen.webm')
  })

  it('does not treat cancellation dispatch as stopped while its own job is still running', async () => {
    const polled = Promise.withResolvers<undefined>()
    const inspected = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const http = await server(async (request, response, state) => {
      if (request.url === '/prompt') { state.status = 'in_progress'; return false }
      if (request.url!.startsWith('/history/')) { polled.resolve(undefined); json(response, {}); return true }
      if (request.url!.endsWith('/cancel')) { json(response, { cancelled: true }); return true }
      if (request.url!.startsWith('/api/jobs/')) {
        inspected.resolve(undefined)
        await release.promise
        json(response, { id: state.submissions[0]!.prompt_id, status: 'cancelled' })
        return true
      }
      return false
    })
    const app = await setup()
    const run = app.start(http.config())
    cleanups.push(async () => { release.resolve(undefined) })
    let settled = false
    void run.operation.then(() => { settled = true }, () => { settled = true })
    await polled.promise
    run.controller.abort(new Error('Stop'))
    await inspected.promise
    expect(settled).toBe(false)
    release.resolve(undefined)
    await expect(run.operation).rejects.toThrow('Stop')
  })

  it('bounds an unacknowledged validation request and reports the unknown remote outcome', async () => {
    const received = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const http = await server(async (request, response, state) => {
      if (request.url !== '/prompt') return false
      const submission = JSON.parse((await body(request)).toString()) as Submission
      received.resolve(undefined)
      await release.promise
      state.submissions.push(submission)
      json(response, { prompt_id: submission.prompt_id, number: 0 })
      return true
    })
    const app = await setup()
    const run = app.start(http.config({ cleanupTimeoutMs: 20 }))
    cleanups.push(async () => { release.resolve(undefined) })
    await received.promise
    run.controller.abort(new Error('Stop before acknowledgment'))
    await expect(run.operation).rejects.toThrow('remote termination is unconfirmed')
    expect(http.state.requests.filter(request => request.url === '/prompt')).toHaveLength(1)
    release.resolve(undefined)
  })

  it('cancels the own job when the total operation deadline expires', async () => {
    const received = Promise.withResolvers<undefined>()
    const http = await server((request, response, state) => {
      if (request.url === '/prompt') { state.status = 'in_progress'; return false }
      if (request.url!.startsWith('/history/')) { received.resolve(undefined); json(response, {}); return true }
      return false
    })
    const app = await setup()
    const run = app.start(http.config({ timeoutMs: 1000 }))
    await received.promise
    await expect(run.operation).rejects.toThrow('exceeded timeoutMs')
    expect(http.state.cancellations).toEqual([http.state.submissions[0]!.prompt_id])
  })
})
