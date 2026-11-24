/** Durable Session-owned storyboard, generation versions, and local film export. */
import { createHash, randomUUID } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { admitEncodedImages } from '@deepseek-ai/dsh-attachment'
import type { AttachmentId, ImageAttachmentRef, VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { deadline } from '@deepseek-ai/dsh-timeout'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { VideoAssetId, VideoProjectId as createVideoProjectId, VideoShotId as createVideoShotId, VideoVersionId } from './brand.ts'
import { resolveConfig, type ResolvedConfig } from './config.ts'
import { exportVideo } from './export.ts'
import { installExportCapability } from './export-capability.ts'
import { ProjectTransfers } from './migration.ts'
import { readWorkspaceStoryboard } from './read-storyboard.ts'
import { ProductionBatches, batchShotInput } from './tasks.ts'
import { videoBatchDomain } from './task-spec.ts'
import type { VideoBatch, VideoBatchGuard, VideoBatchId, VideoBatchInput } from './task-types.ts'
import { imageReference, projectInput, projectRecord, videoProductionDomain, videoReference, type ProjectRow } from './spec.ts'
import type { ConversationVideoModelRow } from './spec.ts'
import { parseWorkspaceStoryboard } from './workspace-storyboard.ts'
import type {
  Config, DescribeVideoGenerator, VideoAssetUpload, VideoGenerationSelection, VideoGenerationTarget, VideoGenerator, VideoMediaChunk,
  VideoProject, VideoProjectInput, VideoProjectId, VideoProjectSummary, VideoShotId,
  VideoVersion, VideoExport,
  VideoProjectTransfer, VideoProjectTransferChunk, VideoProjectTransferId, VideoProjectImportResult,
} from './types.ts'

export type * from './types.ts'
export type * from './task-types.ts'
export { VideoAssetId, VideoProjectId, VideoProjectTransferId, VideoShotId, VideoVersionId } from './brand.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Session-isolated video projects and effect-owned generation providers. */
    videoProduction: VideoProduction
  }
}

const selectionSchema = z.object({
  generator: z.string().min(1).optional(), model: z.string().min(1).optional(), onlyIfMissing: z.boolean().optional(),
}).strict()
const summaryIdsSchema = z.array(z.string().min(1).max(256).transform(value => brandString<SessionId>(value))).max(256)
const uploadSchema = z.object({
  revision: z.number().int().nonnegative(), name: z.string().min(1),
  kind: z.enum(['character', 'scene', 'prop']), description: z.string(),
  image: z.object({ mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), data: z.string(), name: z.string().optional() }).strict(),
}).strict()

const RESULT_TOO_LARGE = 'The generated result exceeds maxProjectBytes.'

function failure(code: string, message: string): never {
  throw new RemoteError('video-production/invalid', message, { reason: code })
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function projectIdentity(sessionId: SessionId): VideoProjectId {
  return createVideoProjectId(`video-${createHash('sha256').update(sessionId).digest('hex')}`)
}

function emptyProject(sessionId: SessionId): VideoProject {
  return { id: projectIdentity(sessionId), sessionId, revision: 0, title: '', assets: [], shots: [], exports: [] }
}

function displayTitle(title: string): string {
  let result = ''
  let characters = 0
  for (const character of title) {
    if (characters === 160) break
    result += character
    characters++
  }
  return result
}

function imagesIn(content: unknown, output: Map<AttachmentId, ImageAttachmentRef>): void {
  if (!Array.isArray(content)) return
  for (const value of content) {
    if (typeof value !== 'object' || value === null) continue
    const block = value as { type?: unknown; attachment?: unknown; content?: unknown }
    if (block.type === 'image') {
      const ref = imageReference.safeParse(block.attachment)
      if (ref.success) output.set(ref.data.attachmentId, ref.data)
    } else if (block.type === 'tool-result') imagesIn(block.content, output)
  }
}

function sessionImages(events: readonly SessionEvent[]): Map<AttachmentId, ImageAttachmentRef> {
  const output = new Map<AttachmentId, ImageAttachmentRef>()
  for (const event of events) {
    const data = event.data as {
      content?: unknown
      message?: { content?: unknown }
      inserted?: readonly { content?: unknown }[]
    }
    imagesIn(data.content, output)
    imagesIn(data.message?.content, output)
    for (const inserted of data.inserted ?? []) imagesIn(inserted.content, output)
    if (event.type === 'assistant/message') {
      for (const record of event.data.stream) {
        if (record.type === 'chunk' && record.chunk.type === 'block-end') imagesIn([record.chunk.block], output)
      }
    }
  }
  return output
}

function interrupted(project: VideoProject): VideoProject | undefined {
  if (!project.shots.some(shot => shot.versions.some(version => version.status === 'running'))
    && !project.exports.some(item => item.status === 'running')) return undefined
  const shots = project.shots.map(shot => ({
    ...shot,
    versions: shot.versions.map((version): VideoVersion => {
      if (version.status !== 'running') return version
      return { ...version, status: 'interrupted', error: 'Generation stopped before the service restarted.' }
    }),
  }))
  const exports = project.exports.map((item): VideoExport => {
    if (item.status !== 'running') return item
    return { ...item, status: 'interrupted', error: 'Export stopped before the service restarted.' }
  })
  return { ...project, revision: project.revision + 1, shots, exports }
}

/** One project per existing Session, persisted through the configured storage-domain backend. */
export class VideoProduction extends TypertRemoteService {
  static inject = ['storageDomain', 'sessions', 'sessionPersistence', 'attachments', 'tools']
  /** Loader validation for project limits and host-local renderer settings. */
  static Config: s<Config> = s.object({
    maxShots: s.number().step(1).min(1).max(256).default(64),
    maxAssets: s.number().step(1).min(1).max(256).default(64),
    maxVersionsPerShot: s.number().step(1).min(1).max(256).default(20),
    maxExports: s.number().step(1).min(1).max(256).default(20),
    maxCaptionsPerShot: s.number().step(1).min(1).max(256).default(64),
    maxProjectBytes: s.number().step(1).min(1024).max(16 * 1024 * 1024).default(1024 * 1024),
    ffmpegPath: s.string().default('ffmpeg'),
    ffprobePath: s.string().default('ffprobe'),
    subtitleFontPath: s.string().default(''),
    exportTimeoutMs: s.number().step(1).min(1).max(2147483647).default(300000),
    generationTimeoutMs: s.number().step(1).min(1).max(2147483647).default(300000),
    exportWidth: s.number().step(2).min(2).max(4096).default(1280),
    exportHeight: s.number().step(2).min(2).max(4096).default(720),
    exportFrameRate: s.number().step(1).min(1).max(120).default(24),
    maxExportBytes: s.number().step(1).min(1).max(2147483647).default(512 * 1024 * 1024),
    processGraceMs: s.number().step(1).min(1).max(2147483647).default(2000),
    maxProcessOutputBytes: s.number().step(1).min(1).max(1024 * 1024).default(16384),
    maxProjectPackageBytes: s.number().step(1).min(1024).max(2147483647).default(768 * 1024 * 1024),
    maxProjectPackageManifestBytes: s.number().step(1).min(1024).max(16 * 1024 * 1024).default(4 * 1024 * 1024),
    maxProjectTransfers: s.number().step(1).min(1).max(64).default(4),
    projectTransferTimeoutMs: s.number().step(1).min(1).max(2147483647).default(30 * 60 * 1000),
  })

  private readonly config: ResolvedConfig
  private readonly transfers: ProjectTransfers
  private batches?: ProductionBatches
  private table?: KvTable<SessionId, ProjectRow>
  private conversationModels?: KvTable<SessionId, ConversationVideoModelRow>
  private readonly tails = new Map<SessionId, Promise<void>>()
  private readonly generators = new Map<string, { generate: VideoGenerator; describe: DescribeVideoGenerator }>()
  private readonly lifetime = new AbortController()
  private closing = false

  /** @param ctx - capability services shared with the shipped profiles. @param config - deployment limits and export executables. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'videoProduction')
    this.config = resolveConfig(config)
    this.transfers = new ProjectTransfers(ctx, this.config, {
      load: sessionId => this.load(sessionId),
      restore: (project, createdAt, signal) => this.enqueue(project.sessionId, async () => {
        signal.throwIfAborted()
        const target = await this.load(project.sessionId)
        if (target.sessionCreatedAt !== createdAt) failure('session-changed', 'The target Session lifecycle changed during restore.')
        if (target.project.revision !== 0) failure('revision-conflict', 'Restore requires a Session without an existing saved project.')
        signal.throwIfAborted()
        return this.commit({ ...project, revision: 0 }, createdAt)
      }),
    })
  }

  /** Open the durable project table and classify unfinished attempts before accepting requests. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(videoProductionDomain)
    this.table = domain.table('projects')
    this.conversationModels = domain.table('conversation_models')
    this.ctx.effect(() => async () => {
      this.closing = true
      this.lifetime.abort(new Error('Video production service is unloading.'))
      await this.batches?.close()
      await this.transfers.close()
      await Promise.all(this.tails.values())
      this.generators.clear()
      await domain.close()
    }, 'video-production domain and operations')
    for (const [sessionId, row] of this.table.entries()) {
      const recovered = interrupted(row.project)
      if (recovered !== undefined) await this.table.put(sessionId, { ...row, project: recovered })
    }
    const batchDomain = await this.ctx.storageDomain.open(videoBatchDomain)
    const batches = new ProductionBatches(batchDomain.table('batches'), {
      load: sessionId => this.load(sessionId),
      targets: () => this.generationTargets(),
      generate: (sessionId, shotId, selection, signal, guard) => this.generateShot(sessionId, shotId, selection, signal, guard),
      report: (error) => { this.ctx.logger.error('Production batch runner failed: %s', error) },
    })
    this.batches = batches
    this.ctx.effect(() => async () => { await batches.close(); await batchDomain.close() }, 'video-production batches')
    await batches.recover()
    this.ctx.effect(() => this.ctx.tools.register(this.projectTool()), 'video-production model tool')
    installExportCapability(this.ctx, this.config)
  }

  /**
   * Register one named generation provider without copying provider credentials.
   * @param name - unique configured generation route name.
   * @param generator - cancellation-aware provider returning a durable attachment.
   * @param describe - current selectable configurations; omission exposes one unrestricted named route.
   * @returns disposer removing only this registration.
   */
  registerGenerator(name: string, generator: VideoGenerator, describe: DescribeVideoGenerator = () => [{ title: name }]): () => void {
    if (this.closing) throw new Error('Video production service is unloading.')
    if (name.trim().length === 0 || this.generators.has(name)) throw new Error(`Video generator name is empty or already registered: ${name}`)
    const registration = { generate: generator, describe }
    const dispose = this.ctx.effect(() => {
      this.generators.set(name, registration)
      return () => { if (this.generators.get(name) === registration) this.generators.delete(name) }
    }, `video generator ${name}`)
    return () => { void dispose() }
  }

  /**
   * List current provider-owned configurations without starting generation or contacting a model.
   * @returns selectable generator/model pairs and declared limits, without credentials.
   */
  @Remote('generationTargets')
  generationTargets(): VideoGenerationTarget[] {
    return [...this.generators].flatMap(([generator, entry]) => entry.describe().map(details => ({ ...details, generator })))
  }

  /**
   * List configured models served by the standalone video tool.
   * @returns Native video targets suitable for selection in a conversation.
   */
  @Remote('conversationGenerationTargets')
  conversationGenerationTargets(): VideoGenerationTarget[] {
    if (this.ctx.tools.get('generate_video') === undefined) return []
    const generator = 'llm-pi-ai'
    return this.generators.get(generator)?.describe().flatMap(details =>
      details.model === undefined ? [] : [{ ...details, generator }]) ?? []
  }

  /**
   * Read the saved selector value for the current Session lifecycle.
   * @param sessionId - Existing Session.
   * @param signal - Caller cancellation during Session inspection.
   * @returns Explicit model selection, even if its route was removed, or undefined when unset.
   */
  @Remote('conversationGenerationTarget')
  async conversationGenerationTarget(sessionId: SessionId, signal?: AbortSignal): Promise<string | undefined> {
    const meta = await this.sessionHeader(sessionId, signal)
    return this.selectedConversationVideoModel(sessionId, meta.createdAt)
  }

  /**
   * Save the standalone generation model separately from the conversational model.
   * @param sessionId - Existing Session to receive the selection.
   * @param model - Exact currently configured native video model ID.
   * @param signal - Caller cancellation before committing the selection.
   * @returns Completion after the selection is durable.
   */
  @Remote('selectConversationGenerationTarget')
  selectConversationGenerationTarget(sessionId: SessionId, model: string, signal?: AbortSignal): Promise<void> {
    return this.enqueue(sessionId, async () => {
      const meta = await this.sessionHeader(sessionId, signal)
      if (!this.conversationGenerationTargets().some(target => target.model === model)) {
        failure('generator-unavailable', 'Choose a configured video generation model for this conversation.')
      }
      const live = this.ctx.sessions.get(sessionId)
      if (live !== undefined) {
        if (live.header.createdAt !== meta.createdAt) failure('session-changed', 'The Session lifecycle changed.')
        await this.ctx.sessions.flush(live)
      }
      signal?.throwIfAborted()
      await this.requireConversationModels().put(sessionId, { sessionCreatedAt: meta.createdAt, model })
    })
  }

  /**
   * Resolve the user's standalone generation selection for the initiating tool call.
   * @param sessionId - Tool caller's Session identity.
   * @param sessionCreatedAt - Tool caller's Session lifecycle timestamp.
   * @returns Exact saved model or undefined when no selection belongs to this lifecycle.
   */
  selectedConversationVideoModel(sessionId: SessionId, sessionCreatedAt: number): string | undefined {
    const row = this.requireConversationModels().get(sessionId)
    return row?.sessionCreatedAt === sessionCreatedAt ? row.model : undefined
  }

  /** Start missing-shot work owned by the Host, independent of the calling page.
   * @param sessionId - existing project Session.
   * @param input - observed project revision and generation route.
   * @returns durably admitted batch without waiting for generation.
   */
  @Remote('startBatch')
  startBatch(sessionId: SessionId, input: VideoBatchInput): Promise<VideoBatch> {
    return this.requireBatches().start(sessionId, input)
  }

  /** Read the latest batch for this Session lifecycle.
   * @param sessionId - existing project Session.
   * @returns durable descriptor, or null when absent.
   */
  @Remote('batch')
  batch(sessionId: SessionId): Promise<VideoBatch | null> {
    return this.requireBatches().view(sessionId)
  }

  /** Read production batches for a bounded set of existing Sessions.
   * @param sessionIds - at most 256 Session identities.
   * @returns current lifecycle descriptors, omitting Sessions without batches.
   */
  @Remote('listBatches')
  async listBatches(sessionIds: readonly SessionId[]): Promise<readonly VideoBatch[]> {
    const ids = summaryIdsSchema.parse(sessionIds)
    const values = await Promise.all(ids.map(id => this.requireBatches().view(id)))
    return values.filter((value): value is VideoBatch => value !== null)
  }

  /** Request pause after the current shot finishes.
   * @param sessionId - owning Session.
   * @param id - observed batch identity.
   * @returns pausing while provider work remains, otherwise paused.
   */
  @Remote('pauseBatch')
  pauseBatch(sessionId: SessionId, id: VideoBatchId): Promise<VideoBatch> {
    return this.requireBatches().stop(sessionId, id, false)
  }

  /** Request cancellation after the current shot finishes; saved results remain available.
   * @param sessionId - owning Session.
   * @param id - observed batch identity.
   * @returns cancelling while provider work remains, otherwise cancelled.
   */
  @Remote('cancelBatch')
  cancelBatch(sessionId: SessionId, id: VideoBatchId): Promise<VideoBatch> {
    return this.requireBatches().stop(sessionId, id, true)
  }

  /** Resume unattempted shots without replaying unconfirmed submissions.
   * @param sessionId - owning Session.
   * @param id - observed batch identity.
   * @returns admitted descriptor after frozen inputs and saved results are checked.
   */
  @Remote('resumeBatch')
  resumeBatch(sessionId: SessionId, id: VideoBatchId): Promise<VideoBatch> {
    return this.requireBatches().resume(sessionId, id)
  }

  private requireBatches(): ProductionBatches {
    if (this.batches === undefined) throw new Error('Video production batches are not initialized.')
    return this.batches
  }

  /**
   * Read bounded saved-project summaries for existing Session identities without creating or resuming an Agent.
   * @param sessionIds - at most 256 distinct Session identities, each at most 256 characters.
   * @param signal - caller cancellation during lifecycle inspection.
   * @returns only currently matching saved projects; display titles contain at most 160 Unicode code points.
   * Deleted Sessions and rows from an earlier lifecycle are omitted; unrelated persistence failures reject.
   */
  @Remote('projectSummaries')
  async projectSummaries(sessionIds: readonly SessionId[], signal: AbortSignal): Promise<readonly VideoProjectSummary[]> {
    signal.throwIfAborted()
    const ids = summaryIdsSchema.parse(sessionIds)
    if (new Set(ids).size !== ids.length) failure('directory-invalid', 'Project summary requests require distinct Session identities.')
    const table = this.requireTable()
    const result: VideoProjectSummary[] = []
    for (const sessionId of ids) {
      signal.throwIfAborted()
      const stored = table.get(sessionId)
      if (stored === undefined || stored.project.revision === 0) continue
      let row: ProjectRow
      try { row = await this.load(sessionId, signal) } catch (error) {
        signal.throwIfAborted()
        if (error instanceof SessionPersistenceNotFoundError) continue
        throw error
      }
      signal.throwIfAborted()
      if (row.project.revision === 0) continue
      result.push({ sessionId, projectId: row.project.id, revision: row.project.revision, displayTitle: displayTitle(row.project.title) })
    }
    return result
  }

  /**
   * Read this Session's project without creating or resuming an Agent.
   * @param sessionId - existing Session selecting the project.
   * @returns the current project, or an unpersisted revision-zero project.
   */
  @Remote('view')
  async view(sessionId: SessionId): Promise<VideoProject> {
    return (await this.load(sessionId)).project
  }

  /**
   * Open a saved project or initialize it from the Session workspace storyboard.
   * @param sessionId - existing Session selecting the workspace and project.
   * @param path - the workspace's `storyboard.md` path.
   * @param signal - cancellation until the project commit starts.
   * @returns the saved project, including a concurrent first import if another caller won.
   */
  @Remote('importWorkspaceStoryboard')
  async importWorkspaceStoryboard(sessionId: SessionId, path: string, signal?: AbortSignal): Promise<VideoProject> {
    const meta = await this.sessionHeader(sessionId, signal)
    if (meta.cwd === undefined) failure('storyboard-path', 'This Session needs a workspace to open a storyboard.')
    const existing = this.requireTable().get(sessionId)
    if (existing?.sessionCreatedAt === meta.createdAt) return existing.project

    const text = await readWorkspaceStoryboard(meta.cwd, path, this.config.maxProjectBytes, signal)
    const parsed = parseWorkspaceStoryboard(text)
    if (parsed === null || parsed.shots.length === 0 || parsed.shots.length > this.config.maxShots) {
      failure('storyboard-format', 'The storyboard needs a title and a supported number of complete shot sections.')
    }

    const input = projectInput.parse({ revision: 0, assets: [], ...parsed })
    return this.enqueue(sessionId, async () => {
      signal?.throwIfAborted()
      const row = await this.load(sessionId, signal)
      if (row.sessionCreatedAt !== meta.createdAt) failure('session-changed', 'The Session lifecycle changed during this operation.')
      if (row.project.revision > 0) return row.project
      return this.replaceProject(row, input, signal)
    })
  }

  /**
   * Replace editable fields while preserving attempts for retained shot identities.
   * @param sessionId - existing Session selecting the project.
   * @param input - observed revision and complete editable project fields.
   * @returns the committed project; stale revisions and foreign image references reject.
   */
  @Remote('update')
  async update(sessionId: SessionId, input: VideoProjectInput): Promise<VideoProject> {
    const parsed = projectInput.parse(input)
    return this.enqueue(sessionId, async () => {
      const row = await this.load(sessionId)
      this.assertRevision(row.project, parsed.revision)
      return this.replaceProject(row, parsed)
    })
  }

  private async replaceProject(row: ProjectRow, parsed: VideoProjectInput, signal?: AbortSignal): Promise<VideoProject> {
    const current = row.project
    const authorized = parsed.assets.some(asset => asset.image !== undefined)
      ? sessionImages(await this.sessionEvents(current.sessionId, signal))
      : new Map<AttachmentId, ImageAttachmentRef>()
    for (const asset of current.assets) if (asset.image !== undefined) authorized.set(asset.image.attachmentId, asset.image)
    for (const shot of current.shots) {
      for (const version of shot.versions) {
        for (const ref of version.referenceImages) authorized.set(ref.attachmentId, ref)
      }
    }
    const assets = parsed.assets.map((asset) => {
      if (asset.image === undefined) return asset
      const image = authorized.get(asset.image.attachmentId)
      if (image === undefined || JSON.stringify(image) !== JSON.stringify(asset.image)) {
        failure('attachment-invalid', 'A reference image does not belong to this Session or project.')
      }
      return { ...asset, image }
    })
    const prior = new Map(current.shots.map(shot => [shot.id, shot]))
    const shots = parsed.shots.map((shot) => {
      const versions = prior.get(shot.id)?.versions ?? []
      if (shot.selectedVersionId !== undefined
        && !versions.some(version => version.id === shot.selectedVersionId && version.status === 'completed')) {
        failure('version-invalid', 'The selected version is not a completed version of this shot.')
      }
      return { ...shot, versions }
    })
    signal?.throwIfAborted()
    return this.commit({ ...current, title: parsed.title, assets, shots }, row.sessionCreatedAt)
  }

  /**
   * Admit a user-uploaded reference and append its asset after durable storage succeeds.
   * @param sessionId - existing Session selecting the project.
   * @param input - observed revision, asset description, and encoded raster image.
   * @param signal - cancellation before image admission and project commit.
   * @returns the committed project containing the newly owned image.
   */
  @Remote('addAsset')
  async addAsset(sessionId: SessionId, input: VideoAssetUpload, signal: AbortSignal): Promise<VideoProject> {
    const parsed = uploadSchema.parse(input)
    return this.enqueue(sessionId, async () => {
      const row = await this.load(sessionId)
      const project = row.project
      this.assertRevision(project, parsed.revision)
      if (project.assets.length >= this.config.maxAssets) failure('limit', 'The project has reached maxAssets.')
      signal.throwIfAborted()
      const refs = await admitEncodedImages(this.ctx.attachments, [{
        mediaType: parsed.image.mediaType, data: parsed.image.data,
        ...parsed.image.name === undefined ? {} : { name: parsed.image.name },
      }])
      signal.throwIfAborted()
      const image = refs[0]
      if (image === undefined) throw new Error('Image admission returned no reference.')
      return this.commit({
        ...project, title: project.title || parsed.name,
        assets: [...project.assets, {
          id: VideoAssetId(randomUUID()), name: parsed.name, kind: parsed.kind,
          description: parsed.description, image,
        }],
      }, row.sessionCreatedAt)
    })
  }

  /**
   * Reorder every current shot exactly once without changing its generation versions.
   * @param sessionId - existing Session selecting the project.
   * @param shotIds - complete permutation of current shot identities.
   * @returns the committed film order.
   */
  @Remote('reorder')
  reorder(sessionId: SessionId, shotIds: readonly VideoShotId[]): Promise<VideoProject> {
    return this.enqueue(sessionId, async () => {
      const row = await this.load(sessionId)
      const project = row.project
      const byId = new Map(project.shots.map(shot => [shot.id, shot]))
      if (shotIds.length !== project.shots.length || new Set(shotIds).size !== shotIds.length) {
        failure('order-invalid', 'Shot order must contain every current shot exactly once.')
      }
      const shots = shotIds.map((id) => {
        const shot = byId.get(id)
        if (shot === undefined) failure('order-invalid', 'Shot order contains an unknown shot identity.')
        return shot
      })
      return this.commit({ ...project, shots }, row.sessionCreatedAt)
    })
  }

  /**
   * Generate a new version from this shot's current prompt and selected reference assets.
   * @param sessionId - existing Session selecting the project.
   * @param shotId - current shot whose versions receive the attempt.
   * @param selection - optional generator, video model, and atomic missing-shot condition.
   * @param signal - caller cancellation; provider work also observes the configured deadline.
   * @returns the unchanged project when onlyIfMissing finds a completed video;
   * otherwise the committed project with a completed, failed, or interrupted attempt.
   */
  @Remote('generate')
  async generate(
    sessionId: SessionId, shotId: VideoShotId, selection: VideoGenerationSelection, signal: AbortSignal,
  ): Promise<VideoProject> {
    return this.generateShot(sessionId, shotId, selection, signal)
  }

  private async generateShot(
    sessionId: SessionId, shotId: VideoShotId, selection: VideoGenerationSelection, signal: AbortSignal, guard?: VideoBatchGuard,
  ): Promise<VideoProject> {
    const options = selectionSchema.parse(selection)
    return this.enqueue(sessionId, async () => {
      const row = await this.load(sessionId)
      let project = row.project
      if (guard !== undefined && (guard.sessionCreatedAt !== row.sessionCreatedAt || guard.input !== batchShotInput(project, shotId))) {
        failure('batch-input-changed', 'The batch Session lifecycle, shot inputs, or reference images changed.')
      }
      const shot = project.shots.find(item => item.id === shotId)
      if (shot === undefined) failure('shot-not-found', 'The requested shot does not exist.')
      if (options.onlyIfMissing === true && shot.versions.some(version => version.status === 'completed' && version.attachment !== undefined)) {
        return project
      }
      if (shot.versions.length >= this.config.maxVersionsPerShot) failure('limit', 'The shot has reached maxVersionsPerShot.')
      const candidates = this.generationTargets().filter(target =>
        (options.generator === undefined || target.generator === options.generator)
        && (options.model === undefined || target.model === options.model))
      const target = candidates[0]
      if (target === undefined) failure('generator-unavailable', 'No matching video generator is configured.')
      if (candidates.length !== 1) failure('generator-ambiguous', 'Choose one configured video generator and model before generating.')
      if (guard !== undefined && guard.generatorRevision !== target.revision) failure('batch-generator-changed', 'The batch generation configuration changed.')
      const registration = this.generators.get(target.generator)
      if (registration === undefined) failure('generator-unavailable', 'The selected video generator was removed.')
      const generator = registration.generate
      const id = VideoVersionId(randomUUID())
      const referenceImages = shot.assetIds.flatMap((assetId) => {
        const image = project.assets.find(item => item.id === assetId)?.image
        return image === undefined ? [] : [image]
      })
      const limits = target.limits
      if ((limits?.durations !== undefined && !limits.durations.includes(shot.duration))
        || (limits?.aspectRatios !== undefined && !limits.aspectRatios.includes(shot.aspectRatio))
        || (limits?.resolutions !== undefined && !limits.resolutions.includes(shot.resolution))
        || (limits?.minReferenceImages !== undefined && referenceImages.length < limits.minReferenceImages)
        || (limits?.maxReferenceImages !== undefined && referenceImages.length > limits.maxReferenceImages)) {
        failure('generator-input-unsupported', 'The shot settings or reference-image count exceed the selected generator limits.')
      }
      const version: VideoVersion = {
        id, status: 'running', prompt: shot.prompt, duration: shot.duration,
        aspectRatio: shot.aspectRatio, resolution: shot.resolution, referenceImages,
        generator: target.generator, generatorTitle: target.title,
        ...target.revision === undefined ? {} : { generatorRevision: target.revision },
        ...target.model === undefined ? {} : { model: target.model },
      }
      const failed: VideoVersion = { ...version, status: 'failed', error: RESULT_TOO_LARGE }
      const reserve = {
        ...project, revision: project.revision + 2,
        shots: project.shots.map(item => item.id === shotId ? { ...item, versions: [...item.versions, failed] } : item),
      }
      if (!this.withinByteLimit(reserve)) failure('limit', 'The project has no room to retain another generation result.')
      project = await this.commit({
        ...project,
        shots: project.shots.map(item => item.id === shotId ? { ...item, versions: [...item.versions, version] } : item),
      }, row.sessionCreatedAt)
      using operation = deadline(AbortSignal.any([signal, this.lifetime.signal]), this.config.generationTimeoutMs, 'VIDEO_GENERATION_TIMEOUT')
      let completed: VideoVersion
      try {
        operation.signal.throwIfAborted()
        if (referenceImages.length !== shot.assetIds.length) {
          failure('reference-image-missing', 'Every selected reference asset must have an admitted image before generation.')
        }
        const result = await generator({
          sessionId, prompt: shot.prompt, duration: shot.duration, aspectRatio: shot.aspectRatio,
          resolution: shot.resolution, referenceImages,
          ...target.model === undefined ? {} : { model: target.model },
        }, operation.signal)
        operation.signal.throwIfAborted()
        const attachment = videoReference.parse(result.attachment)
        await this.ctx.attachments.readVideo(attachment, operation.signal)
        completed = { ...version, status: 'completed', attachment, ...result.model === undefined ? {} : { model: result.model } }
      } catch (error) {
        completed = { ...version, status: operation.signal.aborted ? 'interrupted' : 'failed', error: errorText(error) }
      }
      const terminal = (result: VideoVersion): VideoProject => ({
        ...project, shots: project.shots.map(item => item.id === shotId ? {
          ...item, versions: item.versions.map(attempt => attempt.id === id ? result : attempt),
          ...result.status === 'completed' ? { selectedVersionId: id } : {},
        } : item),
      })
      const full = terminal(completed)
      if (!this.withinByteLimit({ ...full, revision: full.revision + 1 })) completed = failed
      return await this.commit(terminal(completed), row.sessionCreatedAt)
    })
  }

  /**
   * Normalize and concatenate the currently selected completed versions in shot order.
   * @param sessionId - existing Session selecting the project.
   * @param signal - caller cancellation; FFmpeg also observes the configured deadline.
   * @returns the project retaining this successful or failed export attempt.
   */
  @Remote('export')
  export(sessionId: SessionId, signal: AbortSignal): Promise<VideoProject> {
    return this.enqueue(sessionId, async () => {
      const row = await this.load(sessionId)
      let project = row.project
      if (project.shots.length === 0) failure('export-invalid', 'Add at least one generated shot before exporting.')
      if (project.exports.length >= this.config.maxExports) failure('limit', 'The project has reached maxExports.')
      const selected = project.shots.map((shot) => {
        const version = shot.versions.find(item => item.id === shot.selectedVersionId && item.status === 'completed')
        if (version?.attachment === undefined) failure('export-invalid', `Shot "${shot.title}" has no selected completed video.`)
        return { id: version.id, attachment: version.attachment, edit: shot.edit }
      })
      const id = VideoVersionId(randomUUID())
      const attempt: VideoExport = { id, status: 'running', shotVersionIds: selected.map(version => version.id),
        clipEdits: selected.map(version => version.edit ?? null) }
      const failed: VideoExport = { ...attempt, status: 'failed', error: RESULT_TOO_LARGE }
      if (!this.withinByteLimit({ ...project, revision: project.revision + 2, exports: [...project.exports, failed] })) {
        failure('limit', 'The project has no room to retain another export result.')
      }
      project = await this.commit({ ...project, exports: [...project.exports, attempt] }, row.sessionCreatedAt)
      using operation = deadline(AbortSignal.any([signal, this.lifetime.signal]), this.config.exportTimeoutMs, 'VIDEO_EXPORT_TIMEOUT')
      let completed: VideoExport
      try {
        const attachment = await exportVideo(this.ctx, selected, this.config, operation.signal)
        completed = { ...attempt, status: 'completed', attachment }
      } catch (error) {
        completed = { ...attempt, status: operation.signal.aborted ? 'interrupted' : 'failed', error: errorText(error) }
      }
      const terminal = (result: VideoExport): VideoProject => ({
        ...project, exports: project.exports.map(item => item.id === id ? result : item),
      })
      const full = terminal(completed)
      if (!this.withinByteLimit({ ...full, revision: full.revision + 1 })) completed = failed
      return await this.commit(terminal(completed), row.sessionCreatedAt)
    })
  }

  /**
   * Read a bounded media slice only after this exact project proves attachment ownership.
   * @param sessionId - existing Session selecting the project.
   * @param projectId - exact project identity from its latest view.
   * @param attachmentId - image or completed-video identity owned by that project.
   * @param offset - zero-based encoded byte position.
   * @param length - requested bytes, at most the fixed 256 KiB transport safety limit.
   * @returns canonical metadata, base64 slice, and byte offsets.
   */
  @Remote('readMedia')
  async readMedia(
    sessionId: SessionId, projectId: VideoProjectId, attachmentId: AttachmentId, offset: number, length: number,
  ): Promise<VideoMediaChunk> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 256 * 1024) {
      failure('range-invalid', 'Media offsets must be nonnegative integers and length must be from 1 through 262144 bytes.')
    }
    const project = await this.view(sessionId)
    if (project.id !== projectId || project.revision === 0) failure('project-not-found', 'The requested video project does not exist.')
    const refs: (ImageAttachmentRef | VideoAttachmentRef)[] = [
      ...project.assets.flatMap(asset => asset.image === undefined ? [] : [asset.image]),
      ...project.shots.flatMap(shot => shot.versions.flatMap(version => version.referenceImages)),
      ...project.shots.flatMap(shot => shot.versions.flatMap(version => version.status === 'completed' && version.attachment !== undefined ? [version.attachment] : [])),
      ...project.exports.flatMap(item => item.status === 'completed' && item.attachment !== undefined ? [item.attachment] : []),
    ]
    const ref = refs.find(item => item.attachmentId === attachmentId)
    if (ref === undefined) failure('attachment-invalid', 'The attachment is not referenced by this project.')
    const stored = ref.mediaType === 'video/mp4' || ref.mediaType === 'video/webm'
      ? await this.ctx.attachments.readVideo(ref)
      : await this.ctx.attachments.readImage(ref as ImageAttachmentRef)
    if (offset > stored.data.byteLength) failure('range-invalid', 'Media offset exceeds the attachment byte length.')
    const nextOffset = Math.min(offset + length, stored.data.byteLength)
    return { attachment: stored.ref, data: Buffer.from(stored.data.subarray(offset, nextOffset)).toString('base64'), offset, nextOffset, totalBytes: stored.data.byteLength }
  }

  /**
   * Freeze a portable project snapshot and its referenced media in a bounded download.
   * @param sessionId - existing source Session owning the saved project.
   * @param signal - cancellation during attachment reads and package preparation.
   * @returns ephemeral download ticket; the package contains no source Session identity or executable host configuration.
   */
  @Remote('prepareProjectExport')
  prepareProjectExport(sessionId: SessionId, signal: AbortSignal): Promise<VideoProjectTransfer> {
    return this.transfers.prepareExport(sessionId, signal)
  }

  /**
   * Read a prepared portable package without exposing its host path.
   * @param sessionId - Session owning the transfer.
   * @param transferId - live download identity from preparation.
   * @param offset - zero-based encoded file position.
   * @param length - requested raw bytes, from 1 through 262,144.
   * @param signal - caller cancellation.
   * @returns base64 slice and exact raw-byte offsets.
   */
  @Remote('readProjectTransfer')
  readProjectTransfer(
    sessionId: SessionId, transferId: VideoProjectTransferId, offset: number, length: number, signal: AbortSignal,
  ): Promise<VideoProjectTransferChunk> {
    return this.transfers.read(sessionId, transferId, offset, length, signal)
  }

  /**
   * Reserve a bounded upload for restoring into an existing Session with no saved project.
   * @param sessionId - target Session; existing projects are never overwritten.
   * @param bytes - exact total raw package size.
   * @param signal - caller cancellation before reservation.
   * @returns ephemeral upload ticket and its next required byte offset.
   */
  @Remote('beginProjectImport')
  beginProjectImport(sessionId: SessionId, bytes: number, signal: AbortSignal): Promise<VideoProjectTransfer> {
    return this.transfers.beginImport(sessionId, bytes, signal)
  }

  /**
   * Append one canonical base64 slice to an owned project upload.
   * @param sessionId - target Session owning the upload.
   * @param transferId - live upload identity.
   * @param offset - exact next raw byte offset, preventing gaps and duplicate writes.
   * @param data - at most 262,144 decoded bytes as canonical base64.
   * @param signal - caller cancellation during the write.
   * @returns upload ticket with the committed next offset.
   */
  @Remote('writeProjectTransfer')
  writeProjectTransfer(
    sessionId: SessionId, transferId: VideoProjectTransferId, offset: number, data: string, signal: AbortSignal,
  ): Promise<VideoProjectTransfer> {
    return this.transfers.write(sessionId, transferId, offset, data, signal)
  }

  /**
   * Verify the complete package and all media before atomically restoring its project.
   * @param sessionId - target Session, still required to have no saved project.
   * @param transferId - complete live upload identity.
   * @param signal - cancellation through verification, attachment admission, and project commit.
   * @returns restored project and declarative model/workflow requirements; no generator is installed or started.
   */
  @Remote('commitProjectImport')
  commitProjectImport(sessionId: SessionId, transferId: VideoProjectTransferId, signal: AbortSignal): Promise<VideoProjectImportResult> {
    return this.transfers.commit(sessionId, transferId, signal)
  }

  /**
   * Release one owned package upload or download and its private files.
   * @param sessionId - Session owning the transfer.
   * @param transferId - live transfer identity.
   * @returns completion after temporary files are removed; an absent or already-consumed ticket is a no-op.
   */
  @Remote('cancelProjectTransfer')
  cancelProjectTransfer(sessionId: SessionId, transferId: VideoProjectTransferId): Promise<void> {
    return this.transfers.cancel(sessionId, transferId)
  }

  private assertRevision(project: VideoProject, revision: number): void {
    if (project.revision !== revision) failure('revision-conflict', 'The project changed; reload it before saving.')
  }

  private requireTable(): KvTable<SessionId, ProjectRow> {
    if (this.table === undefined) throw new Error('Video production storage is not initialized.')
    return this.table
  }

  private requireConversationModels(): KvTable<SessionId, ConversationVideoModelRow> {
    if (this.conversationModels === undefined) throw new Error('Video production storage is not initialized.')
    return this.conversationModels
  }

  private async sessionHeader(sessionId: SessionId, signal?: AbortSignal): Promise<SessionHeader> {
    const snapshot = await this.ctx.sessionPersistence.stat(sessionId, signal === undefined ? undefined : { signal })
    if (snapshot === undefined) throw new SessionPersistenceNotFoundError(sessionId)
    return snapshot.header
  }

  private async sessionEvents(sessionId: SessionId, signal?: AbortSignal): Promise<readonly SessionEvent[]> {
    signal?.throwIfAborted()
    const live = this.ctx.sessions.get(sessionId)
    if (live !== undefined) await this.ctx.sessions.flush(live)
    const options = signal === undefined ? undefined : { signal }
    await using handle = await this.ctx.sessionPersistence.open(sessionId, 'read', options)
    return (await handle.read(undefined, undefined, options)).events
  }

  private async load(sessionId: SessionId, signal?: AbortSignal): Promise<ProjectRow> {
    const header = await this.sessionHeader(sessionId, signal)
    const row = this.requireTable().get(sessionId)
    return row?.sessionCreatedAt === header.createdAt
      ? row : { sessionCreatedAt: header.createdAt, project: emptyProject(sessionId) }
  }

  private async commit(project: VideoProject, sessionCreatedAt: number): Promise<VideoProject> {
    const next: VideoProject = { ...project, revision: project.revision + 1 }
    const parsed = projectRecord.parse(JSON.parse(JSON.stringify(next)) as unknown)
    if (parsed.shots.length > this.config.maxShots || parsed.assets.length > this.config.maxAssets) failure('limit', 'The project exceeds maxShots or maxAssets.')
    if (parsed.shots.some(shot => (shot.edit?.captions?.length ?? 0) > this.config.maxCaptionsPerShot)) {
      failure('limit', 'An adopted clip exceeds maxCaptionsPerShot.')
    }
    if (!this.withinByteLimit(parsed)) failure('limit', 'The project exceeds maxProjectBytes.')
    const assetIds = new Set(parsed.assets.map(asset => asset.id))
    if (assetIds.size !== parsed.assets.length || new Set(parsed.shots.map(shot => shot.id)).size !== parsed.shots.length) failure('identity-invalid', 'Asset and shot identities must be unique.')
    if (parsed.shots.some(shot => new Set(shot.assetIds).size !== shot.assetIds.length || shot.assetIds.some(id => !assetIds.has(id)))) failure('asset-invalid', 'A shot references an absent or duplicate asset.')
    const header = await this.sessionHeader(project.sessionId)
    if (header.createdAt !== sessionCreatedAt) failure('session-changed', 'The Session lifecycle changed during this operation.')
    const live = this.ctx.sessions.get(project.sessionId)
    if (live !== undefined) {
      if (live.header.createdAt !== sessionCreatedAt) failure('session-changed', 'The Session lifecycle changed during this operation.')
      await this.ctx.sessions.flush(live)
    }
    await this.requireTable().put(project.sessionId, { sessionCreatedAt, project: parsed })
    return parsed
  }

  private withinByteLimit(project: VideoProject): boolean {
    return Buffer.byteLength(JSON.stringify(project), 'utf8') <= this.config.maxProjectBytes
  }

  private enqueue<T>(sessionId: SessionId, operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Video production service is unloading.'))
    const previous = this.tails.get(sessionId) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.tails.set(sessionId, tail)
    return result.finally(() => { if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId) })
  }

  private projectTool() {
    return defineTool({
      name: 'video_project',
      description: 'Create and edit a storyboard with reusable character, scene, and prop images. Generate or retry individual shots, select completed versions, reorder shots, and export the selected clips as one MP4. View the project before updating and include its current revision. Every result includes the complete current project.',
      parameters: {
        action: { type: 'string', enum: ['view', 'update', 'generate', 'reorder', 'export'], required: true },
        input: { type: 'json', description: 'For update: {revision,title,assets:[{id,name,kind,description,image?}],shots:[{id,title,prompt,duration,aspectRatio,resolution,assetIds,position:{x,y},selectedVersionId?,edit?:{trimStartSeconds?,trimEndSeconds?,volume?,captions:[{startSeconds,endSeconds,text}]}}]}. Caption times start at zero after trimming; volume 0 mutes and 1 preserves source audio. Use stable unique ids. Images must already belong to this Session or project.' },
        shotId: { type: 'string', description: 'Shot identity for generate.' },
        shotIds: { type: 'array', items: { type: 'string' }, description: 'Complete ordered list of shot identities for reorder.' },
        generator: { type: 'string', description: 'Optional configured generation provider for generate.' },
        model: { type: 'string', description: 'Optional video model for generate.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
        presentationMeta: (_args, value: JsonValue) => value,
      },
      execute: async (raw, exec) => {
        const args = z.object({
          action: z.enum(['view', 'update', 'generate', 'reorder', 'export']), input: z.unknown().optional(),
          shotId: z.string().min(1).optional(), shotIds: z.array(z.string().min(1)).optional(),
          generator: z.string().min(1).optional(), model: z.string().min(1).optional(),
        }).strict().parse(raw)
        const sessionId = exec.agent?.session.id
        if (sessionId === undefined) throw new Error('video_project requires an initiating Session.')
        const execute = async (): Promise<VideoProject> => {
          switch (args.action) {
            case 'view': return this.view(sessionId)
            case 'update': return this.update(sessionId, projectInput.parse(args.input))
            case 'generate': {
              if (args.shotId === undefined) failure('shot-invalid', 'generate requires shotId.')
              return this.generate(sessionId, createVideoShotId(args.shotId), {
                ...args.generator === undefined ? {} : { generator: args.generator },
                ...args.model === undefined ? {} : { model: args.model },
              }, exec.signal)
            }
            case 'reorder': {
              if (args.shotIds === undefined) failure('order-invalid', 'reorder requires shotIds.')
              return this.reorder(sessionId, args.shotIds.map(createVideoShotId))
            }
            case 'export': return this.export(sessionId, exec.signal)
            default: return args.action satisfies never
          }
        }
        return JSON.parse(JSON.stringify(await execute())) as Record<string, JsonValue>
      },
    })
  }
}

export default VideoProduction
