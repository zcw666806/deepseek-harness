/** Cancelable workflow configuration requests, independent of engine management. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { WorkflowConfiguration, WorkflowConfigurationView } from '@deepseek-ai/dsh-video-comfyui/types'

/** Configuration-only Host methods. */
export interface WorkflowRemote {
  view(signal: AbortSignal): Promise<WorkflowConfigurationView>
  validate(configuration: WorkflowConfiguration, signal: AbortSignal): Promise<{ valid: true }>
  save(configuration: WorkflowConfiguration, revision: number, signal: AbortSignal): Promise<WorkflowConfigurationView>
  setEnabled(enabled: boolean, revision: number, signal: AbortSignal): Promise<WorkflowConfigurationView>
}
/** Authoritative configuration and request feedback. */
export interface WorkflowSnapshot {
  readonly view: WorkflowConfigurationView | null
  readonly requested: boolean
  readonly busy: boolean
  readonly validated: boolean
  readonly error: string | null
}
/** Framework-bound workflow data and plain management callbacks. */
export interface WorkflowFace {
  readonly hooks: { readonly workflows: SnapshotStore<WorkflowSnapshot> }
  readonly loadWorkflows: () => void
  readonly validateWorkflows: (configuration: WorkflowConfiguration) => void
  readonly saveWorkflows: (configuration: WorkflowConfiguration) => void
  readonly enableWorkflows: (enabled: boolean) => void
}
/** Owns cancellation and waits for requests before unloading. */
export class WorkflowController {
  private readonly source = createSnapshotStore<WorkflowSnapshot>({
    view: null, requested: false, busy: false, validated: false, error: null,
  })
  private readonly tasks = new Set<Promise<void>>()
  private active: AbortController | null = null
  private disposed = false
  private disposal: Promise<void> | undefined

  /** @param remote - configuration-only generated Host methods. */
  constructor(private readonly remote: WorkflowRemote) {}

  /**
   * Bind the settings entry to this controller's snapshot and explicit actions.
   * @returns stable observable and callbacks for the settings entry.
   */
  inject(): WorkflowFace {
    return {
      hooks: { workflows: this.source },
      loadWorkflows: () => { this.run(signal => this.remote.view(signal)) },
      validateWorkflows: (configuration) => {
        this.run(async (signal) => { await this.remote.validate(configuration, signal); return null })
      },
      saveWorkflows: (configuration) => {
        const view = this.source.getSnapshot().view
        if (view !== null) this.run(signal => this.remote.save(configuration, view.revision, signal))
      },
      enableWorkflows: (enabled) => {
        const view = this.source.getSnapshot().view
        if (view !== null) this.run(signal => this.remote.setEnabled(enabled, view.revision, signal))
      },
    }
  }

  /** Invalidate the connection's reports and cancel its requests. */
  reset(): void {
    if (this.disposed) return
    this.active?.abort()
    this.active = null
    this.source.set({ view: null, requested: false, busy: false, validated: false, error: null })
  }

  /**
   * Stop publication and await every admitted configuration request.
   * @returns completion after all owned requests settle without further publication.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.active?.abort()
    this.active = null
    this.disposal = Promise.allSettled([...this.tasks]).then(() => {})
    return this.disposal
  }

  private run(request: (signal: AbortSignal) => Promise<WorkflowConfigurationView | null>): void {
    if (this.disposed || this.active !== null) return
    const controller = new AbortController()
    const settled = Promise.withResolvers<void>()
    this.tasks.add(settled.promise)
    void settled.promise.then(() => this.tasks.delete(settled.promise), () => this.tasks.delete(settled.promise))
    this.active = controller
    this.source.set({ ...this.source.getSnapshot(), requested: true, busy: true, validated: false, error: null })
    void this.execute(controller, request).then(settled.resolve, settled.reject)
  }

  private async execute(
    controller: AbortController,
    request: (signal: AbortSignal) => Promise<WorkflowConfigurationView | null>,
  ): Promise<void> {
    if (this.active !== controller) return
    try {
      const view = await request(controller.signal)
      if (this.active === controller) this.source.set({ ...this.source.getSnapshot(), ...(view === null ? { validated: true } : { view }) })
    } catch (error) {
      if (this.active === controller && !controller.signal.aborted) {
        this.source.set({ ...this.source.getSnapshot(), error: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      if (this.active === controller) {
        this.active = null
        this.source.set({ ...this.source.getSnapshot(), busy: false })
      }
    }
  }
}
