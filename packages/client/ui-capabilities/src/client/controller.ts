/** Cancelable Host capability operations with reconnect-safe publication. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { parseCapabilityFile } from './manifest.ts'
import type { CapabilityAction, CapabilityId, CapabilityView, CapabilityRestorePlan, CapabilityRestoreResult, PortableCapabilityManifest } from '@deepseek-ai/dsh-capability-manager/types'

/** Generated Remote methods adapted to plain results. */
export interface CapabilityRemote {
  exportManifest(signal: AbortSignal): Promise<PortableCapabilityManifest>
  planRestore(manifest: PortableCapabilityManifest, signal: AbortSignal): Promise<CapabilityRestorePlan>
  restoreManifest(manifest: PortableCapabilityManifest, signal: AbortSignal): Promise<readonly CapabilityRestoreResult[]>
  list(signal: AbortSignal): Promise<readonly CapabilityView[]>
  perform(id: CapabilityId, action: CapabilityAction, signal: AbortSignal): Promise<CapabilityView>
}
/** Current reports and the one operation owned by this settings section. */
export interface CapabilitySnapshot {
  readonly items: readonly CapabilityView[] | null
  readonly operation: { readonly kind: 'list' | 'manifestExport' | 'manifestPlan' | 'manifestRestore' } | { readonly kind: 'action'; readonly id: CapabilityId; readonly action: CapabilityAction } | null
  readonly manifestDownload: string | null
  readonly restorations: readonly CapabilityRestoreResult[]
  readonly restorePlan: CapabilityRestorePlan | null
  readonly requested: boolean
  readonly cancelling: boolean
  readonly error: string | null
}
/** Plain callbacks and the observable bound by the slot renderer. */
export interface CapabilityFace {
  readonly hooks: { readonly capabilities: SnapshotStore<CapabilitySnapshot> }
  readonly exportManifest: () => void
  readonly restoreFile: (file: File) => void
  readonly applyRestoration: () => void
  readonly discardRestoration: () => void
  readonly refresh: () => void
  readonly perform: (id: CapabilityId, action: CapabilityAction) => void
  readonly cancel: () => void
}
/** Owns capability request cancellation and rejects late results from a replaced connection. */
export class CapabilityController {
  private readonly source = createSnapshotStore<CapabilitySnapshot>({
    items: null, manifestDownload: null, restorations: [], restorePlan: null, operation: null,
    requested: false, cancelling: false, error: null,
  })
  private readonly tasks = new Set<Promise<void>>()
  private disposal: Promise<void> | undefined
  private active: AbortController | null = null
  private generation = 0
  private disposed = false
  private pendingManifest: PortableCapabilityManifest | null = null

  /**
   * @param remote - Host methods returning authoritative capability reports.
   * @param urls - Owned browser download URLs.
   */
  constructor(
    private readonly remote: CapabilityRemote,
    private readonly urls = { create: (blob: Blob) => URL.createObjectURL(blob), revoke: (url: string) => { URL.revokeObjectURL(url) } },
  ) {}

  /**
   * Bind authoritative reports and management callbacks to the settings section.
   * @returns Callbacks and a stable source for the settings entry.
   */
  inject(): CapabilityFace {
    return {
      hooks: { capabilities: this.source },
      exportManifest: () => { void this.run({ kind: 'manifestExport' }, async (signal) => {
        const manifest = await this.remote.exportManifest(signal)
        signal.throwIfAborted()
        if (this.active?.signal === signal) {
          const previous = this.source.getSnapshot().manifestDownload
          if (previous !== null) this.urls.revoke(previous)
          const url = this.urls.create(new Blob([JSON.stringify(manifest, null, 2) + '\n'], { type: 'application/json' }))
          this.source.set({ ...this.source.getSnapshot(), manifestDownload: url })
        }
        return this.source.getSnapshot().items ?? []
      }) },
      restoreFile: (file) => { void this.run({ kind: 'manifestPlan' }, async (signal) => {
        this.pendingManifest = null
        this.source.set({ ...this.source.getSnapshot(), restorePlan: null, restorations: [] })
        const manifest = parseCapabilityFile(await file.text())
        signal.throwIfAborted()
        const restorePlan = await this.remote.planRestore(manifest, signal)
        signal.throwIfAborted()
        if (this.active?.signal === signal) {
          this.pendingManifest = manifest
          this.source.set({ ...this.source.getSnapshot(), restorePlan })
        }
        return this.source.getSnapshot().items ?? []
      }) },
      applyRestoration: () => {
        const manifest = this.pendingManifest
        if (manifest === null) return
        void this.run({ kind: 'manifestRestore' }, async (signal) => {
          const restorations = await this.remote.restoreManifest(manifest, signal)
          signal.throwIfAborted()
          if (this.active?.signal === signal) {
            this.pendingManifest = null
            this.source.set({ ...this.source.getSnapshot(), restorations, restorePlan: null })
          }
          return await this.remote.list(signal)
        })
      },
      discardRestoration: () => {
        if (this.active !== null || this.disposed) return
        this.pendingManifest = null
        this.source.set({ ...this.source.getSnapshot(), restorePlan: null })
      },
      refresh: () => { void this.run({ kind: 'list' }, signal => this.remote.list(signal)) },
      perform: (id, action) => { void this.run({ kind: 'action', id, action }, async (signal) => {
        const item = await this.remote.perform(id, action, signal)
        const items = this.source.getSnapshot().items ?? []
        return items.some(previous => previous.id === item.id)
          ? items.map(previous => previous.id === item.id ? item : previous) : [...items, item]
      }) },
      cancel: () => {
        if (this.active === null) return
        this.source.set({ ...this.source.getSnapshot(), cancelling: true })
        this.active.abort()
      },
    }
  }

  /** Abort the old connection and require a fresh Host report. */
  reset(): void {
    if (this.disposed) return
    const url = this.source.getSnapshot().manifestDownload
    if (url !== null) this.urls.revoke(url)
    this.generation++
    this.active?.abort()
    this.active = null
    this.pendingManifest = null
    this.source.set({
      items: null, manifestDownload: null, restorations: [], restorePlan: null, operation: null,
      requested: false, cancelling: false, error: null,
    })
  }

  /**
   * Close admission and wait for in-flight configuration operations before releasing downloads.
   * @returns completion after pending Remote requests have settled.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.generation++
    this.active?.abort()
    this.active = null
    this.pendingManifest = null
    this.disposal = this.settleDisposal()
    return this.disposal
  }

  private async settleDisposal(): Promise<void> {
    await Promise.allSettled([...this.tasks])
    const download = this.source.getSnapshot().manifestDownload
    if (download !== null) this.urls.revoke(download)
  }

  private track(start: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const settled = Promise.withResolvers<void>()
    this.tasks.add(settled.promise)
    void settled.promise.then(() => this.tasks.delete(settled.promise), () => this.tasks.delete(settled.promise))
    void start().then(settled.resolve, settled.reject)
    return settled.promise
  }

  private isCurrent(generation: number): boolean { return !this.disposed && generation === this.generation }

  private run(
    operation: NonNullable<CapabilitySnapshot['operation']>,
    request: (signal: AbortSignal) => Promise<readonly CapabilityView[]>,
  ): Promise<void> {
    return this.track(() => this.performRun(operation, request))
  }

  private async performRun(
    operation: NonNullable<CapabilitySnapshot['operation']>,
    request: (signal: AbortSignal) => Promise<readonly CapabilityView[]>,
  ): Promise<void> {
    if (this.disposed || this.active !== null) return
    const controller = new AbortController()
    const generation = this.generation
    this.active = controller
    this.source.set({ ...this.source.getSnapshot(), operation, requested: true, cancelling: false, error: null })
    try {
      const items = await request(controller.signal)
      if (this.isCurrent(generation)) this.source.set({ ...this.source.getSnapshot(), items })
    } catch (error) {
      if (this.isCurrent(generation) && !controller.signal.aborted) {
        this.source.set({ ...this.source.getSnapshot(), error: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      if (this.active === controller) {
        this.active = null
        if (this.isCurrent(generation)) this.source.set({ ...this.source.getSnapshot(), operation: null, cancelling: false })
      }
    }
  }
}
