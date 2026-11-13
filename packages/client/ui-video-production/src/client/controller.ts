/** Session-bound project operations and disposable media URLs for the browser workspace. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bytesToBase64 } from '@deepseek-ai/dsh-util-crypto'
import { resolveWorkspaceConfig } from '../config.ts'
import type { PortableCapabilityManifest, CapabilityRestoreResult } from '@deepseek-ai/dsh-capability-manager/types'
import type { AttachmentId, ImageAttachmentRef, VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  VideoAsset, VideoAssetUpload, VideoGenerationSelection, VideoGenerationTarget, VideoMediaChunk, VideoProject,
  VideoProjectId, VideoProjectInput, VideoProjectTransfer, VideoProjectTransferChunk, VideoProjectTransferId,
  VideoProjectImportResult, VideoShot, VideoShotId, VideoBatch, VideoBatchId, VideoBatchInput,
} from '@deepseek-ai/dsh-video-production/types'

/** Binary reference accepted by the project's authorized media reader. */
export type ProductionMediaRef = ImageAttachmentRef | VideoAttachmentRef

/** Transport-independent actions bound to one Session by the plugin. */
export interface ProductionRemote {
  startBatch(input: VideoBatchInput): Promise<VideoBatch>
  batch(): Promise<VideoBatch | null>
  pauseBatch(id: VideoBatchId): Promise<VideoBatch>
  cancelBatch(id: VideoBatchId): Promise<VideoBatch>
  resumeBatch(id: VideoBatchId): Promise<VideoBatch>
  restoreCapabilities(manifest: PortableCapabilityManifest, signal: AbortSignal): Promise<readonly CapabilityRestoreResult[]>
  prepareProjectExport(signal: AbortSignal): Promise<VideoProjectTransfer>
  readProjectTransfer(id: VideoProjectTransferId, offset: number, length: number, signal: AbortSignal): Promise<VideoProjectTransferChunk>
  beginProjectImport(bytes: number, signal: AbortSignal): Promise<VideoProjectTransfer>
  writeProjectTransfer(id: VideoProjectTransferId, offset: number, data: string, signal: AbortSignal): Promise<VideoProjectTransfer>
  commitProjectImport(id: VideoProjectTransferId, signal: AbortSignal): Promise<VideoProjectImportResult>
  cancelProjectTransfer(id: VideoProjectTransferId): Promise<void>
  generationTargets(): Promise<readonly VideoGenerationTarget[]>
  view(): Promise<VideoProject>
  update(input: VideoProjectInput): Promise<VideoProject>
  generate(shotId: VideoShotId, options: VideoGenerationSelection, signal: AbortSignal): Promise<VideoProject>
  reorder(shotIds: readonly VideoShotId[]): Promise<VideoProject>
  export(signal: AbortSignal): Promise<VideoProject>
  readMedia(projectId: VideoProjectId, attachmentId: AttachmentId, offset: number, length: number): Promise<VideoMediaChunk>
  addAsset(input: VideoAssetUpload, signal: AbortSignal): Promise<VideoProject>
}

/** In-flight mutation shown independently of durable generation attempts. */
export type ProductionOperation =
  | { readonly kind: 'load' | 'save' | 'reorder' | 'asset' }
  | { readonly kind: 'generate'; readonly shotId: VideoShotId }
  | { readonly kind: 'export' | 'restoreCapabilities' }
  | { readonly kind: 'transfer'; readonly direction: 'export' | 'import' }
  | {
    readonly kind: 'batch'
    readonly currentShotId: VideoShotId | null
    readonly completed: number
    readonly total: number
  }

/** Structured batch diagnostics rendered by the workspace's locale dictionary. */
export interface ProductionBatchIssue {
  readonly reason: 'prompt-missing' | 'reference-missing' | 'shot-running' | 'result-incomplete'
  readonly shotId: VideoShotId
}

/** Immutable snapshot consumed through the renderer's injected hook. */
export interface ProductionSnapshot {
  readonly batch: VideoBatch | null
  readonly project: VideoProject | null
  readonly transfer: { readonly direction: 'export' | 'import'; readonly completed: number; readonly total: number } | null
  readonly projectDownload: { readonly url: string; readonly fileName: string } | null
  readonly capabilityRestorations: readonly CapabilityRestoreResult[]
  readonly restored: Omit<VideoProjectImportResult, 'project'> | null
  readonly targets: readonly VideoGenerationTarget[] | null
  readonly operation: ProductionOperation | null
  readonly error: string | null
  readonly batchIssue?: ProductionBatchIssue | null
  readonly media: Readonly<Record<string, string>>
  readonly mediaLoading: readonly string[]
  readonly mediaErrors: Readonly<Record<string, string>>
}

/** Snapshot source and actions supplied to the registered workspace entry. */
export interface ProductionFace {
  readonly pauseBatch: () => void
  readonly cancelBatch: () => void
  readonly resumeBatch: () => void
  readonly hooks: { readonly production: SnapshotStore<ProductionSnapshot> }
  readonly restoreCapabilities: () => void
  readonly exportProject: () => void
  readonly importProject: (file: File) => void
  readonly refresh: () => void
  readonly save: (input: VideoProjectInput) => void
  readonly generate: (shotId: VideoShotId, options?: VideoGenerationSelection) => void
  readonly generateMissing: (options?: VideoGenerationSelection) => void
  readonly reorder: (shotIds: readonly VideoShotId[]) => void
  readonly exportFilm: () => void
  readonly cancel: () => void
  readonly loadMedia: (ref: ProductionMediaRef) => void
  readonly addAsset: (file: File, name: string, kind: VideoAsset['kind']) => void
}

interface ObjectUrls {
  create(blob: Blob): string
  revoke(url: string): void
}

class BatchIssueError extends Error {
  constructor(readonly issue: ProductionBatchIssue) { super(issue.reason) }
}

function hasCompletedVideo(shot: VideoShot): boolean {
  return shot.versions.some(version => version.status === 'completed' && version.attachment !== undefined)
}

function validateBatch(project: VideoProject, shots: readonly VideoShot[]): void {
  const assets = new Map(project.assets.map(asset => [asset.id, asset]))
  for (const shot of shots) {
    if (shot.prompt.trim().length === 0) throw new BatchIssueError({ reason: 'prompt-missing', shotId: shot.id })
    if (shot.assetIds.some(id => assets.get(id)?.image === undefined)) {
      throw new BatchIssueError({ reason: 'reference-missing', shotId: shot.id })
    }
    if (shot.versions.some(version => version.status === 'running')) {
      throw new BatchIssueError({ reason: 'shot-running', shotId: shot.id })
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(data)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index)
  return bytes
}

function referencedMedia(project: VideoProject): Set<string> {
  const ids = new Set<string>()
  for (const asset of project.assets) if (asset.image !== undefined) ids.add(asset.image.attachmentId)
  for (const shot of project.shots) {
    for (const version of shot.versions) {
      if (version.attachment !== undefined) ids.add(version.attachment.attachmentId)
      for (const image of version.referenceImages) ids.add(image.attachmentId)
    }
  }
  for (const result of project.exports) if (result.attachment !== undefined) ids.add(result.attachment.attachmentId)
  return ids
}

/** Owns one Session's server projection, pending mutation, and media URL lifetime. */
export class ProductionController {
  private readonly source = createSnapshotStore<ProductionSnapshot>({
    project: null, batch: null, transfer: null, projectDownload: null, restored: null,
    capabilityRestorations: [], targets: null, operation: null,
    error: null, batchIssue: null, media: {}, mediaLoading: [], mediaErrors: {},
  })
  private readonly tasks = new Set<Promise<void>>()
  private disposal: Promise<void> | undefined
  private operation: AbortController | undefined
  private disposed = false
  private generation = 0
  private readonly mediaPending = new Set<string>()
  private pollTimer: ReturnType<typeof setTimeout> | undefined
  private polling = false
  private observation = 0

  /**
   * @param remote - RPC actions already bound to the Session identity.
   * @param objectUrls - browser object URL owner used for media previews.
   * @param onProject - same-generation project publication observer for the feature directory.
   * @param batchPollIntervalMs - configured delay between batch observations.
   */
  constructor(
    private readonly remote: ProductionRemote,
    private readonly objectUrls: ObjectUrls = {
      create: blob => URL.createObjectURL(blob),
      revoke: (url) => { URL.revokeObjectURL(url) },
    },
    private readonly onProject?: (project: VideoProject) => void,
    private readonly batchPollIntervalMs = resolveWorkspaceConfig({}).batchPollIntervalMs,
  ) {}

  /**
   * Build callbacks and the source bound by the slot renderer.
   * @returns a plain injected face with a framework-owned hook compartment.
   */
  inject(): ProductionFace {
    return {
      hooks: { production: this.source },
      pauseBatch: () => { this.controlBatch(id => this.remote.pauseBatch(id)) },
      cancelBatch: () => { this.controlBatch(id => this.remote.cancelBatch(id)) },
      resumeBatch: () => { this.controlBatch(id => this.remote.resumeBatch(id)) },
      restoreCapabilities: () => { void this.run({ kind: 'restoreCapabilities' }, async (signal) => {
        const { project, restored } = this.source.getSnapshot()
        if (project === null || restored?.capabilities === undefined) throw new Error('No imported capability configuration is available.')
        const capabilityRestorations = await this.remote.restoreCapabilities(restored.capabilities, signal)
        signal.throwIfAborted()
        const targets = await this.remote.generationTargets()
        if (this.activeOperation(signal)) this.source.set({ ...this.source.getSnapshot(), capabilityRestorations, targets })
        return project
      }) },
      exportProject: () => { void this.run({ kind: 'transfer', direction: 'export' }, signal => this.exportProject(signal)) },
      importProject: (file) => { void this.run({ kind: 'transfer', direction: 'import' }, signal => this.importProject(file, signal)) },
      refresh: () => { void this.run({ kind: 'load' }, async (signal) => {
        const [project, targets, batch] = await Promise.all([this.remote.view(), this.remote.generationTargets(), this.remote.batch()])
        if (this.activeOperation(signal)) this.source.set({ ...this.source.getSnapshot(), targets, batch })
        return project
      }) },
      save: (input) => { void this.run({ kind: 'save' }, () => this.remote.update(input)) },
      generate: (shotId, options = {}) => {
        void this.run({ kind: 'generate', shotId }, signal => this.remote.generate(shotId, options, signal))
      },
      generateMissing: (options = {}) => {
        const selection = { ...options }
        void this.run({ kind: 'batch', currentShotId: null, completed: 0, total: 0 }, signal => this.generateMissing(selection, signal))
      },
      reorder: (shotIds) => { void this.run({ kind: 'reorder' }, () => this.remote.reorder(shotIds)) },
      exportFilm: () => { void this.run({ kind: 'export' }, signal => this.remote.export(signal)) },
      cancel: () => { this.operation?.abort() },
      loadMedia: (ref) => { void this.track(() => this.loadMedia(ref)) },
      addAsset: (file, name, kind) => {
        const project = this.source.getSnapshot().project
        if (project === null) return
        void this.run({ kind: 'asset' }, async signal => this.remote.addAsset({
          revision: project.revision, name, kind, description: '',
          image: {
            mediaType: file.type as ImageAttachmentRef['mediaType'],
            data: bytesToBase64(new Uint8Array(await file.arrayBuffer())), name: file.name,
          },
        }, signal))
      },
    }
  }

  /** Discard stale RPC settlements and release all browser media objects on reconnect. */
  resetConnection(): void {
    if (this.disposed) return
    this.generation++
    this.clearPoll()
    this.operation?.abort()
    this.operation = undefined
    this.releaseMedia()
    this.source.set({
      project: null, batch: null, transfer: null, projectDownload: null, restored: null,
      capabilityRestorations: [], targets: null, operation: null,
      error: null, batchIssue: null, media: {}, mediaLoading: [], mediaErrors: {},
    })
  }

  /**
   * Close admission, abort operations, and await ticket/media cleanup before releasing URLs.
   * @returns completion after every operation admitted before disposal has settled.
   */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.clearPoll()
    this.generation++
    this.operation?.abort()
    this.operation = undefined
    this.disposal = this.settleDisposal()
    return this.disposal
  }

  private async settleDisposal(): Promise<void> {
    await Promise.allSettled([...this.tasks])
    this.releaseMedia()
  }

  private track(start: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const settled = Promise.withResolvers<void>()
    this.tasks.add(settled.promise)
    void settled.promise.then(() => this.tasks.delete(settled.promise), () => this.tasks.delete(settled.promise))
    void start().then(settled.resolve, settled.reject)
    return settled.promise
  }

  private releaseMedia(): void {
    const download = this.source.getSnapshot().projectDownload
    if (download !== null) this.objectUrls.revoke(download.url)
    for (const url of Object.values(this.source.getSnapshot().media)) this.objectUrls.revoke(url)
    this.mediaPending.clear()
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation
  }

  private publishProject(project: VideoProject, operation = this.source.getSnapshot().operation): void {
    this.onProject?.(project)
    const current = this.source.getSnapshot()
    const retained = referencedMedia(project)
    for (const [id, url] of Object.entries(current.media)) {
      if (!retained.has(id)) this.objectUrls.revoke(url)
    }
    for (const id of this.mediaPending) if (!retained.has(id)) this.mediaPending.delete(id)
    this.source.set({
      ...current, project, operation, error: null, batchIssue: null,
      media: Object.fromEntries(Object.entries(current.media).filter(([id]) => retained.has(id))),
      mediaErrors: Object.fromEntries(Object.entries(current.mediaErrors).filter(([id]) => retained.has(id))),
      mediaLoading: [...this.mediaPending],
    })
  }

  private activeOperation(signal: AbortSignal): boolean {
    return !this.disposed && this.operation?.signal === signal
  }

  private async exportProject(signal: AbortSignal): Promise<VideoProject> {
    const project = this.source.getSnapshot().project
    if (project === null) throw new Error('The project must be loaded before export.')
    let transferId: VideoProjectTransferId | undefined
    this.source.set({ ...this.source.getSnapshot(), transfer: { direction: 'export', completed: 0, total: 0 } })
    try {
      const ticket = await this.remote.prepareProjectExport(signal)
      transferId = ticket.id
      signal.throwIfAborted()
      const parts: Uint8Array<ArrayBuffer>[] = []
      for (let offset = 0; offset < ticket.bytes;) {
        const chunk = await this.remote.readProjectTransfer(ticket.id, offset, 262144, signal)
        signal.throwIfAborted()
        const bytes = decodeBase64(chunk.data)
        if (chunk.offset !== offset || chunk.nextOffset !== offset + bytes.length || chunk.nextOffset <= offset
          || chunk.nextOffset > ticket.bytes || chunk.totalBytes !== ticket.bytes) throw new Error('Project package returned invalid byte offsets.')
        parts.push(bytes)
        offset = chunk.nextOffset
        if (this.activeOperation(signal)) this.source.set({
          ...this.source.getSnapshot(), transfer: { direction: 'export', completed: offset, total: ticket.bytes },
        })
      }
      if (this.activeOperation(signal)) {
        const current = this.source.getSnapshot().projectDownload
        if (current !== null) this.objectUrls.revoke(current.url)
        const url = this.objectUrls.create(new Blob(parts, { type: 'application/octet-stream' }))
        this.source.set({ ...this.source.getSnapshot(), projectDownload: { url, fileName: ticket.fileName } })
      }
      return project
    } finally {
      if (transferId !== undefined) await this.remote.cancelProjectTransfer(transferId)
    }
  }

  private async importProject(file: File, signal: AbortSignal): Promise<VideoProject> {
    if (this.source.getSnapshot().project?.revision !== 0) throw new Error('Restore requires an empty current Session.')
    let transferId: VideoProjectTransferId | undefined
    this.source.set({ ...this.source.getSnapshot(), restored: null, capabilityRestorations: [], transfer: { direction: 'import', completed: 0, total: file.size } })
    try {
      let ticket = await this.remote.beginProjectImport(file.size, signal)
      transferId = ticket.id
      signal.throwIfAborted()
      for (let offset = 0; offset < file.size;) {
        const bytes = new Uint8Array(await file.slice(offset, offset + 262144).arrayBuffer())
        signal.throwIfAborted()
        ticket = await this.remote.writeProjectTransfer(ticket.id, offset, bytesToBase64(bytes), signal)
        signal.throwIfAborted()
        if (ticket.nextOffset !== offset + bytes.length || ticket.bytes !== file.size) throw new Error('Project upload returned invalid byte offsets.')
        offset = ticket.nextOffset
        if (this.activeOperation(signal)) this.source.set({
          ...this.source.getSnapshot(), transfer: { direction: 'import', completed: offset, total: file.size },
        })
      }
      const { project, ...restored } = await this.remote.commitProjectImport(ticket.id, signal)
      transferId = undefined
      if (this.activeOperation(signal)) this.source.set({ ...this.source.getSnapshot(), restored })
      return project
    } finally {
      if (transferId !== undefined) await this.remote.cancelProjectTransfer(transferId)
    }
  }

  private async generateMissing(selection: VideoGenerationSelection, signal: AbortSignal): Promise<VideoProject> {
    const project = await this.remote.view()
    if (!this.activeOperation(signal)) return project
    signal.throwIfAborted()
    validateBatch(project, project.shots.filter(shot => !hasCompletedVideo(shot)))
    const batch = await this.remote.startBatch({ ...selection, revision: project.revision })
    if (this.activeOperation(signal)) this.source.set({ ...this.source.getSnapshot(), batch })
    return project
  }

  private controlBatch(perform: (id: VideoBatchId) => Promise<VideoBatch>): void {
    const batch = this.source.getSnapshot().batch
    if (batch === null) return
    void this.run({ kind: 'batch', currentShotId: null, completed: 0, total: batch.shots.length }, async (signal) => {
      const next = await perform(batch.id)
      if (this.activeOperation(signal)) this.source.set({ ...this.source.getSnapshot(), batch: next })
      return this.remote.view()
    })
  }

  private clearPoll(): void {
    if (this.pollTimer !== undefined) clearTimeout(this.pollTimer)
    this.pollTimer = undefined
  }

  private schedulePoll(): void {
    this.clearPoll()
    const batch = this.source.getSnapshot().batch
    if (this.disposed || this.polling || batch === null || !['running', 'pausing', 'cancelling'].includes(batch.status)) return
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined
      if (this.operation !== undefined) { this.schedulePoll(); return }
      void this.track(() => this.pollBatch())
    }, this.batchPollIntervalMs)
  }

  private async pollBatch(): Promise<void> {
    this.polling = true
    const generation = this.generation
    const observation = this.observation
    try {
      const [project, batch] = await Promise.all([this.remote.view(), this.remote.batch()])
      if (!this.isCurrent(generation) || observation !== this.observation) return
      this.source.set({ ...this.source.getSnapshot(), batch })
      this.publishProject(project)
    } catch (error) {
      if (this.isCurrent(generation) && observation === this.observation) {
        this.source.set({ ...this.source.getSnapshot(), error: errorText(error) })
      }
    } finally {
      this.polling = false
      this.schedulePoll()
    }
  }
  private run(
    operation: ProductionOperation,
    perform: (signal: AbortSignal) => Promise<VideoProject>,
  ): Promise<void> {
    return this.track(() => this.performRun(operation, perform))
  }

  private async performRun(
    operation: ProductionOperation,
    perform: (signal: AbortSignal) => Promise<VideoProject>,
  ): Promise<void> {
    if (this.disposed || this.operation !== undefined) return
    this.observation++
    this.clearPoll()
    const controller = new AbortController()
    this.operation = controller
    const generation = this.generation
    this.source.set({ ...this.source.getSnapshot(), operation, error: null, batchIssue: null })
    try {
      const project = await perform(controller.signal)
      if (!this.isCurrent(generation)) return
      this.publishProject(project)
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.source.set({
          ...this.source.getSnapshot(),
          error: error instanceof BatchIssueError ? null : errorText(error),
          batchIssue: error instanceof BatchIssueError ? error.issue : null,
        })
      }
    } finally {
      if (this.operation === controller) {
        this.operation = undefined
        if (this.isCurrent(generation)) {
          this.source.set({ ...this.source.getSnapshot(), operation: null, transfer: null })
          this.schedulePoll()
        }
      }
    }
  }

  private async loadMedia(ref: ProductionMediaRef): Promise<void> {
    const snapshot = this.source.getSnapshot()
    const id = String(ref.attachmentId)
    if (this.disposed || snapshot.project === null || !referencedMedia(snapshot.project).has(id)
      || snapshot.media[id] !== undefined || this.mediaPending.has(id)) return
    this.mediaPending.add(id)
    const generation = this.generation
    this.source.set({ ...snapshot, mediaLoading: [...this.mediaPending] })
    try {
      const parts: Uint8Array<ArrayBuffer>[] = []
      let offset = 0
      while (offset < ref.bytes) {
        const chunk = await this.remote.readMedia(snapshot.project.id, ref.attachmentId, offset, 256 * 1024)
        if (!this.isCurrent(generation)) return
        const project = this.source.getSnapshot().project
        if (project === null || !referencedMedia(project).has(id)) return
        const bytes = decodeBase64(chunk.data)
        if (chunk.offset !== offset || chunk.nextOffset !== offset + bytes.length
          || chunk.nextOffset <= offset || chunk.totalBytes !== ref.bytes || chunk.nextOffset > ref.bytes) {
          throw new Error('Video production media returned inconsistent byte offsets.')
        }
        parts.push(bytes)
        offset = chunk.nextOffset
      }
      const url = this.objectUrls.create(new Blob(parts, { type: ref.mediaType }))
      this.source.set({ ...this.source.getSnapshot(), media: { ...this.source.getSnapshot().media, [id]: url } })
    } catch (error) {
      if (this.isCurrent(generation)) {
        const current = this.source.getSnapshot()
        this.source.set({ ...current, mediaErrors: { ...current.mediaErrors, [id]: errorText(error) } })
      }
    } finally {
      if (this.isCurrent(generation)) {
        this.mediaPending.delete(id)
        this.source.set({ ...this.source.getSnapshot(), mediaLoading: [...this.mediaPending] })
      }
    }
  }
}
