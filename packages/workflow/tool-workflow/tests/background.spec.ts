import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { JobId } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { WorkflowEngine, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { WorkflowResult, WorkflowRun, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import * as toolWorkflow from '../src/index.ts'

class ControlledEngine extends WorkflowEngine {
  requests: WorkflowStartRequest[] = []
  cancelled: (string | undefined)[] = []
  disposed = 0
  disposal: Promise<void> | undefined
  startError: Error | undefined
  settle!: (result: WorkflowResult) => void

  start(request: WorkflowStartRequest): WorkflowRun {
    if (this.startError !== undefined) throw this.startError
    this.requests.push(request)
    const result = new Promise<WorkflowResult>((resolve) => { this.settle = resolve })
    return {
      id: WorkflowRunId('background-run'),
      meta: request.meta,
      result,
      cancel: (reason) => {
        this.cancelled.push(reason)
        this.settle({ value: null, stopReason: 'cancelled', agentsStarted: 0 })
      },
      dispose: async () => {
        this.disposed += 1
        await this.disposal
      },
    }
  }
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(dispose => dispose()))
})

async function harness(options: { jobs?: boolean; controller?: boolean } = {}) {
  const root = new Context()
  const fixtureFiber = root.plugin(() => {})
  cleanups.push(async () => { await fixtureFiber.dispose() })
  const ctx = root
  await fixtureFiber.ctx.plugin(AgentRegistry)
  await fixtureFiber.ctx.plugin(SystemPrompt)
  await fixtureFiber.ctx.plugin(ToolRuntime)
  await fixtureFiber.ctx.plugin(ControlledEngine)
  let disposeJobs: (() => Promise<void>) | undefined
  if (options.jobs !== false) {
    const jobsFiber = await fixtureFiber.ctx.plugin(LocalJobRegistry)
    disposeJobs = async () => { await jobsFiber.dispose() }
    if (options.controller !== false) ctx.jobs.attachController('test')
  }
  const fiber = await fixtureFiber.ctx.plugin(toolWorkflow, {})
  const ownerFiber = fixtureFiber.ctx.plugin(() => {})
  const session = Session.create(SessionId('workflow-owner'))
  const owner: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: ownerFiber.ctx,
    send() {},
    followup() {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' }) }),
    inject() {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(owner)
  const engine = ctx.workflowEngine as ControlledEngine
  const execute = (signal = new AbortController().signal, args?: Record<string, unknown>) => ctx.tools.execute({
    callId: ToolCallId('workflow-call'),
    name: 'workflow',
    arguments: {
      script: 'return { ok: true }',
      meta: { name: 'background-audit', description: 'test' },
      run_in_background: true,
      ...args === undefined ? {} : { args },
    },
    agent: owner,
    signal,
  })
  return { ctx, engine, owner, ownerFiber, session, execute, fiber, disposeJobs }
}

describe('background workflows', () => {
  it.each([
    [{ jobs: false }, 'background workflows unavailable'],
    [{ controller: false }, 'no job controller serves this agent'],
  ])('refuses an unavailable collector before creating a workflow: %j', async (options, message) => {
    const { execute, engine } = await harness(options)
    const result = await execute()
    expect(result.isError).toBe(true)
    expect(result.content.map(block => block.type === 'text' ? block.text : '')).toEqual([expect.stringContaining(message)])
    expect(engine.requests).toHaveLength(0)
  })

  it('returns a job immediately and reports completion only after disposal settles', async () => {
    const { ctx, execute, engine, owner, session } = await harness()
    let release!: () => void
    engine.disposal = new Promise<void>((resolve) => { release = resolve })
    try {
      const started = await execute(undefined, { paths: ['source.ts'] })
      expect(started.isError).toBe(false)
      if (started.isError) throw new Error('expected background start')
      expect(started.value).toEqual({ jobId: 'workflow-1' })
      expect(started.content.map(block => block.type === 'text' ? block.text : '')).toEqual([expect.stringContaining('started in background')])
      expect(engine.requests[0]?.signal).toBeUndefined()
      expect(engine.requests[0]?.args).toEqual({ paths: ['source.ts'] })
      expect(ctx.jobs.get(JobId('workflow-1'), owner).status).toBe('running')
      engine.settle({ value: { ok: true }, stopReason: 'completed', agentsStarted: 2 })
      await vi.waitFor(() => { expect(engine.disposed).toBe(1) })
      expect(ctx.jobs.get(JobId('workflow-1'), owner).status).toBe('running')
      expect(session.events.map(event => event.type)).not.toContain('tool-workflow/run-end')
      release()
      expect((await ctx.jobs.wait(JobId('workflow-1'), 10_000, owner)).status).toBe('completed')
      expect(ctx.jobs.read(JobId('workflow-1'), owner).text).toContain('workflow "background-audit" completed (2 agents)')
      expect(session.events.some(event => event.type.startsWith('tool-workflow/'))).toBe(false)
    } finally {
      release()
    }
  })

  it('keeps an admitted workflow alive when its initiating tool signal aborts', async () => {
    const { ctx, execute, engine, owner } = await harness()
    const controller = new AbortController()
    await execute(controller.signal)
    controller.abort('parent step stopped')
    expect(engine.cancelled).toEqual([])
    engine.settle({ value: 1, stopReason: 'completed', agentsStarted: 0 })
    expect((await ctx.jobs.wait(JobId('workflow-1'), 10_000, owner)).status).toBe('completed')
  })

  it('does not register a job when the engine rejects startup', async () => {
    const { ctx, execute, engine, owner } = await harness()
    engine.startError = new Error('invalid workflow script')
    const result = await execute()
    expect(result.isError).toBe(true)
    expect(ctx.jobs.list(owner)).toEqual([])
  })

  it.each([
    ['error', 'failed', 'workflow run failed: bad child'],
    ['cancelled', 'killed', 'workflow run was cancelled (bad child)'],
  ] as const)('reports a %s settlement through the job controls', async (stopReason, status, output) => {
    const { ctx, execute, engine, owner } = await harness()
    await execute()
    engine.settle({ value: { partial: true }, stopReason, error: 'bad child', agentsStarted: 1 })
    expect((await ctx.jobs.wait(JobId('workflow-1'), 10_000, owner)).status).toBe(status)
    expect(ctx.jobs.read(JobId('workflow-1'), owner).text).toBe(output)
    expect(engine.disposed).toBe(1)
  })

  it('stops and disposes the workflow through job_kill', async () => {
    const { ctx, execute, engine, owner } = await harness()
    await execute()
    expect(ctx.jobs.kill(JobId('workflow-1'), owner, 'user stopped workflow')).toBe('requested')
    expect((await ctx.jobs.wait(JobId('workflow-1'), 10_000, owner)).status).toBe('killed')
    expect(engine.cancelled).toEqual(['user stopped workflow'])
    expect(engine.disposed).toBe(1)
  })

  it('waits for cleanup when its owner is disposed', async () => {
    const { execute, engine, ownerFiber } = await harness()
    await execute()
    await ownerFiber.dispose()
    expect(engine.cancelled).toHaveLength(1)
    expect(engine.disposed).toBe(1)
  })

  it('cancels and waits for cleanup when the job service is disposed', async () => {
    const { execute, engine, disposeJobs } = await harness()
    await execute()
    await disposeJobs!()
    expect(engine.cancelled).toHaveLength(1)
    expect(engine.disposed).toBe(1)
  })

  it('turns a failed cleanup into a failed job without recording a false terminal event', async () => {
    const { ctx, execute, engine, owner, session } = await harness()
    await execute()
    engine.disposal = Promise.reject(new Error('cleanup failed'))
    engine.settle({ value: 1, stopReason: 'completed', agentsStarted: 0 })
    expect((await ctx.jobs.wait(JobId('workflow-1'), 10_000, owner)).status).toBe('failed')
    expect(ctx.jobs.read(JobId('workflow-1'), owner).text).toContain('cleanup failed')
    expect(session.events.some(event => event.type === 'tool-workflow/run-end')).toBe(false)
  })

  it('lets registered jobs outlive the tool fiber without creating a foreground workflow record', async () => {
    const { ctx, execute, engine, owner, session, fiber } = await harness()
    await execute()
    await fiber.dispose()
    engine.settle({ value: 1, stopReason: 'completed', agentsStarted: 0 })
    expect((await ctx.jobs.wait(JobId('workflow-1'), 10_000, owner)).status).toBe('completed')
    expect(session.events.some(event => event.type === 'tool-workflow/run-end')).toBe(false)
  })
})
