/** Host-backed directory for saved video projects, independent of open conversation views. */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { VideoProject, VideoProjectSummary } from '@deepseek-ai/dsh-video-production/types'

/** Bounded Host metadata query; it never creates an Agent. */
export type ProjectSummaryReader = (
  ids: readonly SessionId[], signal: AbortSignal,
) => Promise<readonly VideoProjectSummary[]>

/** Publishes authoritative project titles without changing Session conversation metadata. */
export class ProjectDirectory {
  /** Read-only consumers receive the stable source, not a copy of its current value. */
  readonly source: ObservableSnapshot<readonly VideoProjectSummary[]>
  private readonly state = createSnapshotStore<readonly VideoProjectSummary[]>([])
  private readonly projects = new Map<SessionId, VideoProjectSummary>()
  private readonly observed = new Map<SessionId, number>()
  private readonly requests = new Set<Promise<void>>()
  private ids: readonly SessionId[] = []
  private active: AbortController | undefined
  private epoch = 0
  private disposed = false
  private disposal: Promise<void> | undefined

  /**
   * Create a feature-owned index without opening any project view.
   * @param read - generated Host project-summary query.
   */
  constructor(private readonly read: ProjectSummaryReader) { this.source = this.state }

  /**
   * Rebuild metadata for currently listed Sessions in protocol-sized batches.
   * @param ids - Session directory identities; omission refreshes the previous set.
   */
  refresh(ids: readonly SessionId[] = this.ids): void {
    if (this.disposed) return
    this.ids = [...new Set(ids)]
    const retained = new Set(this.ids)
    for (const id of this.projects.keys()) if (!retained.has(id)) this.projects.delete(id)
    this.publish()
    this.active?.abort()
    const controller = new AbortController()
    this.active = controller
    const epoch = ++this.epoch
    const versions = new Map(this.observed)
    const task = this.load(this.ids, versions, controller.signal, epoch)
    this.requests.add(task)
    void task.then(() => this.requests.delete(task), () => this.requests.delete(task))
  }

  /**
   * Apply one committed or explicitly refreshed project before an older directory response can replace it.
   * @param project - current-generation Host project response.
   */
  observe(project: VideoProject): void {
    if (this.disposed) return
    this.observed.set(project.sessionId, (this.observed.get(project.sessionId) ?? 0) + 1)
    if (project.revision === 0) this.projects.delete(project.sessionId)
    else this.projects.set(project.sessionId, {
      sessionId: project.sessionId, projectId: project.id, revision: project.revision,
      displayTitle: Array.from(project.title).slice(0, 160).join(''),
    })
    this.publish()
  }

  /** Discard the old connection's metadata and pending publications. */
  reset(): void {
    if (this.disposed) return
    this.epoch++
    this.active?.abort()
    this.active = undefined
    this.ids = []
    this.projects.clear()
    this.observed.clear()
    this.publish()
  }

  /**
   * Close admission and await current and superseded directory reads.
   * @returns completion after admitted directory reads have settled.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.epoch++
    this.active?.abort()
    this.disposal = Promise.allSettled([...this.requests]).then(() => undefined)
    return this.disposal
  }

  private current(epoch: number, signal: AbortSignal): boolean {
    return !this.disposed && !signal.aborted && epoch === this.epoch
  }

  private async load(
    ids: readonly SessionId[], observed: ReadonlyMap<SessionId, number>, signal: AbortSignal, epoch: number,
  ): Promise<void> {
    try {
      const summaries = new Map<SessionId, VideoProjectSummary>()
      // The projectSummaries wire operation accepts at most 256 unique Session identities.
      for (let offset = 0; offset < ids.length; offset += 256) {
        const batch = await this.read(ids.slice(offset, offset + 256), signal)
        if (!this.current(epoch, signal)) return
        for (const item of batch) summaries.set(item.sessionId, item)
      }
      if (!this.current(epoch, signal)) return
      for (const id of ids) {
        if (this.observed.get(id) !== observed.get(id)) continue
        const summary = summaries.get(id)
        if (summary === undefined) this.projects.delete(id)
        else this.projects.set(id, summary)
      }
      this.publish()
    } catch (error) {
      if (this.current(epoch, signal)) console.warn('Video project directory refresh failed.', error)
    }
  }

  private publish(): void { this.state.set([...this.projects.values()]) }
}
