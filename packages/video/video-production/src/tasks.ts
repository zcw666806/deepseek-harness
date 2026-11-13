/** Host-owned shot batches checkpoint before submission and never replay uncertain requests. */
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { ProjectRow } from './spec.ts'
import type { VideoBatch, VideoBatchGuard, VideoBatchId, VideoBatchInput } from './task-types.ts'
import type { VideoGenerationSelection, VideoGenerationTarget, VideoProject, VideoShotId } from './types.ts'

const inputSchema = z.object({
  revision: z.number().int().positive(), generator: z.string().min(1).optional(),
  model: z.string().min(1).optional(), onlyIfMissing: z.boolean().optional(),
}).strict()

/** Capture only fields that affect the submitted video, including ordered reference metadata.
 * @param project - current persisted project.
 * @param shotId - shot to capture.
 * @returns stable serialized input, rejecting a removed shot.
 */
export function batchShotInput(project: VideoProject, shotId: VideoShotId): string {
  const shot = project.shots.find(item => item.id === shotId)
  if (shot === undefined) throw new Error('The batch shot was removed from the project.')
  return JSON.stringify({
    prompt: shot.prompt, duration: shot.duration, aspectRatio: shot.aspectRatio, resolution: shot.resolution,
    references: shot.assetIds.map(id => ({ id, image: project.assets.find(asset => asset.id === id)?.image })),
  })
}

interface BatchOperations {
  load(sessionId: SessionId): Promise<ProjectRow>
  targets(): readonly VideoGenerationTarget[]
  generate(
    sessionId: SessionId, shotId: VideoShotId, selection: VideoGenerationSelection, signal: AbortSignal, guard: VideoBatchGuard,
  ): Promise<VideoProject>
  report(error: unknown): void
}

/** One persisted batch per project, with transient runners owned by the service lifetime. */
export class ProductionBatches {
  private readonly tails = new Map<SessionId, Promise<void>>()
  private readonly runners = new Map<SessionId, Promise<void>>()
  private readonly lifetime = new AbortController()

  /** @param table - open batch domain table. @param operations - project-owned admission and generation. */
  constructor(private readonly table: KvTable<SessionId, VideoBatch>, private readonly operations: BatchOperations) {}

  /** Classify crash checkpoints without submitting work.
   * @returns completion of durable recovery writes.
   */
  async recover(): Promise<void> {
    for (const [sessionId, batch] of this.table.entries()) {
      if (!['running', 'pausing', 'cancelling'].includes(batch.status)) continue
      const shots = batch.shots.map(shot => shot.status === 'running'
        ? { ...shot, status: 'uncertain' as const, error: 'Host stopped before submission outcome was recorded; check the provider before retrying.' } : shot)
      await this.table.put(sessionId, { ...batch, shots, status: shots.some(shot => shot.status === 'uncertain') ? 'needs-review' : 'paused' })
    }
  }

  /** Read the current lifecycle's batch without starting an Agent.
   * @param sessionId - existing Session.
   * @returns current batch, or null when this lifecycle has none.
   */
  async view(sessionId: SessionId): Promise<VideoBatch | null> {
    const row = await this.operations.load(sessionId)
    const batch = this.table.get(sessionId)
    return batch?.sessionCreatedAt === row.sessionCreatedAt ? structuredClone(batch) : null
  }

  /** Save missing-shot work before launching a browser-independent runner.
   * @param sessionId - existing project Session.
   * @param input - current revision and generation route.
   * @returns committed descriptor, without waiting for generation.
   */
  async start(sessionId: SessionId, input: VideoBatchInput): Promise<VideoBatch> {
    const parsed = inputSchema.parse(input)
    const result = await this.serial(sessionId, async () => {
      const row = await this.operations.load(sessionId)
      const prior = await this.view(sessionId)
      if (prior !== null && (this.runners.has(sessionId) || prior.shots.some(shot => shot.status === 'uncertain' || shot.status === 'running')
        || !['completed', 'cancelled'].includes(prior.status))) throw new Error('Resume or cancel the existing production batch first; uncertain submissions require review.')
      if (row.project.revision !== parsed.revision) throw new Error('The project changed; reload it before starting a batch.')
      const targets = this.operations.targets().filter(target => (parsed.generator === undefined || target.generator === parsed.generator)
        && (parsed.model === undefined || target.model === parsed.model))
      const target = targets[0]
      if (targets.length !== 1 || target === undefined) throw new Error('Choose one available video generator and model.')
      const shots = row.project.shots.filter(shot => !shot.versions.some(version => version.status === 'completed' && version.attachment !== undefined))
        .map(shot => ({ shotId: shot.id, input: batchShotInput(row.project, shot.id), status: 'pending' as const }))
      const batch: VideoBatch = {
        id: brandString<VideoBatchId>(randomUUID()), sessionId, sessionCreatedAt: row.sessionCreatedAt,
        projectId: row.project.id, inputRevision: parsed.revision, generator: target.generator,
        ...target.model === undefined ? {} : { model: target.model },
        ...target.revision === undefined ? {} : { generatorRevision: target.revision },
        status: shots.length === 0 ? 'completed' : 'running', shots,
      }
      await this.table.put(sessionId, batch)
      return batch
    })
    this.launch(sessionId)
    return structuredClone(result)
  }

  /** Stop after the current shot settles; the returned transitional status does not mean the provider stopped.
   * @param sessionId - owning Session.
   * @param id - observed batch identity.
   * @param cancel - cancel instead of pause.
   * @returns committed stop request or terminal descriptor.
   */
  stop(sessionId: SessionId, id: VideoBatchId, cancel: boolean): Promise<VideoBatch> {
    return this.serial(sessionId, async () => {
      const batch = await this.require(sessionId, id)
      if (batch.status === 'completed') return batch
      const running = batch.shots.some(shot => shot.status === 'running')
      const next: VideoBatch = { ...batch, status: cancel ? (running ? 'cancelling' : 'cancelled') : (running ? 'pausing' : 'paused') }
      await this.table.put(sessionId, next)
      return structuredClone(next)
    })
  }

  /** Resume pending work without resubmitting uncertain attempts.
   * @param sessionId - owning Session.
   * @param id - observed batch identity.
   * @returns committed descriptor; unmatched inputs or missing completed results reject before submission.
   */
  async resume(sessionId: SessionId, id: VideoBatchId): Promise<VideoBatch> {
    const result = await this.serial(sessionId, async () => {
      const batch = await this.require(sessionId, id)
      if (this.runners.has(sessionId)) throw new Error('Wait for the current shot and stop request to settle before resuming.')
      try { await this.validate(batch) } catch (error) {
        await this.table.put(sessionId, { ...batch, status: 'needs-review', error: String(error) })
        throw error
      }
      const shots = batch.shots
      const next: VideoBatch = { ...batch, shots, error: undefined,
        status: shots.some(shot => shot.status === 'pending') ? 'running' : shots.some(shot => shot.status === 'uncertain') ? 'needs-review' : 'completed' }
      await this.table.put(sessionId, next)
      return next
    })
    this.launch(sessionId)
    return structuredClone(result)
  }

  /** Abort provider work and await every runner and durable control write before domain closure.
   * @returns resolution after the batch owner reaches quiescence.
   */
  async close(): Promise<void> {
    this.lifetime.abort(new Error('Video production Host is unloading.'))
    await Promise.all([...this.runners.values(), ...this.tails.values()])
  }

  private async require(sessionId: SessionId, id: VideoBatchId): Promise<VideoBatch> {
    const batch = await this.view(sessionId)
    if (batch === null || batch.id !== id) throw new Error('The production batch does not belong to this Session lifecycle.')
    return batch
  }

  private async validate(batch: VideoBatch): Promise<void> {
    const row = await this.operations.load(batch.sessionId)
    if (row.sessionCreatedAt !== batch.sessionCreatedAt || row.project.id !== batch.projectId) throw new Error('The batch Session lifecycle changed.')
    const targets = this.operations.targets().filter(target => target.generator === batch.generator && target.model === batch.model)
    if (targets.length !== 1 || targets[0]?.revision !== batch.generatorRevision) throw new Error('The batch generation configuration changed; review the project before submitting more work.')
    for (const shot of batch.shots) {
      if (batchShotInput(row.project, shot.shotId) !== shot.input) throw new Error('The batch shot inputs or reference images changed; review the project before submitting more work.')
      if (shot.status === 'completed' && !row.project.shots.find(item => item.id === shot.shotId)?.versions.some(version =>
        version.id === shot.versionId && version.status === 'completed' && version.attachment !== undefined)) {
        throw new Error('A completed batch result is absent from the project; check the provider before retrying.')
      }
    }
  }

  private launch(sessionId: SessionId): void {
    if (this.lifetime.signal.aborted || this.runners.has(sessionId)) return
    const runner = this.run(sessionId).catch((error: unknown) => { this.operations.report(error) }).finally(() => {
      if (this.runners.get(sessionId) === runner) this.runners.delete(sessionId)
    })
    this.runners.set(sessionId, runner)
  }

  private async run(sessionId: SessionId): Promise<void> {
    while (!this.lifetime.signal.aborted) {
      const reserved = await this.serial(sessionId, async () => {
        const batch = await this.view(sessionId)
        if (batch === null || batch.status !== 'running') return null
        try { await this.validate(batch) } catch (error) {
          await this.table.put(sessionId, { ...batch, status: 'needs-review', error: String(error) })
          return null
        }
        const shot = batch.shots.find(item => item.status === 'pending')
        if (shot === undefined) {
          const status = batch.shots.some(item => item.status === 'uncertain') ? 'needs-review' : 'completed'
          await this.table.put(sessionId, { ...batch, status })
          return null
        }
        await this.table.put(sessionId, { ...batch, shots: batch.shots.map(item => item === shot ? { ...item, status: 'running' } : item) })
        return { batch, shot }
      })
      if (reserved === null) return
      const { batch, shot } = reserved
      let project: VideoProject | undefined
      let error: string | undefined
      try {
        project = await this.operations.generate(sessionId, shot.shotId, {
          generator: batch.generator, ...batch.model === undefined ? {} : { model: batch.model }, onlyIfMissing: true,
        }, this.lifetime.signal, {
          sessionCreatedAt: batch.sessionCreatedAt, input: shot.input, generatorRevision: batch.generatorRevision,
        })
      } catch (cause) { error = String(cause) }
      const completed = project?.shots.find(item => item.id === shot.shotId)?.versions.findLast(version => version.status === 'completed' && version.attachment !== undefined)
      await this.serial(sessionId, async () => {
        const current = await this.require(sessionId, batch.id)
        const shots = current.shots.map(item => item.shotId === shot.shotId
          ? { ...item, status: completed === undefined ? 'uncertain' as const : 'completed' as const,
            versionId: completed?.id, error: completed === undefined ? error ?? 'Submission did not produce a saved video; check the provider before retrying.' : undefined } : item)
        await this.table.put(sessionId, { ...current, shots,
          status: current.status === 'pausing' ? 'paused' : current.status === 'cancelling' ? 'cancelled'
            : completed === undefined ? 'needs-review' : this.lifetime.signal.aborted ? 'paused' : 'running' })
      }, true)
    }
  }

  private serial<T>(sessionId: SessionId, operation: () => Promise<T>, settling = false): Promise<T> {
    if (!settling && this.lifetime.signal.aborted) return Promise.reject(new Error('Video production Host is unloading.'))
    const result = (this.tails.get(sessionId) ?? Promise.resolve()).then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.tails.set(sessionId, tail)
    return result.finally(() => { if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId) })
  }
}
