/** Workspace-owned manuscripts, revision-checked edits, and lossless artwork transfer. */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import s from '@deepseek-ai/schemastery'
import { failure } from './failure.ts'
import { ComicImages, prepareImage, type PreparedImage } from './images.ts'
import { comicProductionDomain, draftProblem, draftSchema, imagesOf, packageSchema, projectTitle, sameImage } from './spec.ts'
import type {
  ComicDraft, ComicImage, ComicImageChunk, ComicImageId, ComicLayerId, ComicPageId, ComicPanelId,
  ComicProject, ComicProjectId, ComicProjectPackage, ComicProjectSummary, Config,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Workspace-owned manuscript and original artwork operations. */
    comicProduction: ComicProduction
  }
}

const maxSlice = 256 * 1024
const defaults = {
  maxImageBytes: 12 * 1024 * 1024,
  maxImagePixels: 16 * 1024 * 1024,
  maxProjectBytes: 1024 * 1024,
  maxPackageBytes: 32 * 1024 * 1024,
}

function initialDraft(title: string): ComicDraft {
  return {
    title,
    pages: Array.from({ length: 3 }, () => ({
      id: brandString<ComicPageId>(randomUUID()), title: '', width: 1200, height: 1600,
      panels: [{
        id: brandString<ComicPanelId>(randomUUID()), x: 64, y: 64, width: 1072, height: 1472,
        description: '', notes: '', bubbles: [],
        layers: [{ id: brandString<ComicLayerId>(randomUUID()), name: '', visible: true, versions: [], imageId: null }],
      }],
    })),
  }
}

function snapshot({ title, pages }: ComicDraft): ComicDraft {
  return { title, pages }
}

function packageEnvelope(draft: ComicDraft, images: ComicProjectPackage['images']): ComicProjectPackage {
  return { format: 'dsh-comic-project', version: 1, draft: snapshot(draft), images }
}

function checkRevision(project: ComicProject, revision: number): void {
  if (project.revision !== revision) failure('revision-conflict', 'The project changed. Reload it before applying this edit.')
}

function checkArtworkHistory(current: ComicProject, draft: ComicDraft): void {
  const storedLayers = new Map(current.pages.flatMap(page =>
    page.panels.flatMap(panel => panel.layers.map(layer => [layer.id, layer] as const))))
  for (const page of draft.pages) for (const panel of page.panels) for (const layer of panel.layers) {
    const prior = storedLayers.get(layer.id)?.versions ?? []
    const unchanged = prior.length === layer.versions.length && layer.versions.every((image, index) => {
      const original = prior[index]
      return original !== undefined && sameImage(original, image)
    })
    if (!unchanged) {
      failure('history-invalid', 'An edit cannot add or rewrite an artwork version. Import a PNG into the layer instead.')
    }
  }
}

function withArtwork(project: ComicProject, panelId: ComicPanelId, layerId: ComicLayerId, image: ComicImage): ComicDraft {
  const panel = project.pages.flatMap(page => page.panels).find(panel => panel.id === panelId)
  const layer = panel?.layers.find(layer => layer.id === layerId)
  if (layer === undefined) failure('layer-not-found', 'The selected panel or layer no longer exists.')
  const original = layer.versions[0]
  if (original !== undefined && (original.width !== image.width || original.height !== image.height)) {
    failure('image-dimensions', 'Import a PNG with the same pixel dimensions as the original artwork.')
  }
  const present = layer.versions.some(version => version.id === image.id)
  if (!present && layer.versions.length === 128) failure('history-limit', 'This layer has reached its artwork version limit.')
  const replacement = { ...layer, imageId: image.id, versions: present ? layer.versions : [...layer.versions, image] }
  return {
    title: project.title,
    pages: project.pages.map(page => ({
      ...page,
      panels: page.panels.map(item => item.id === panelId
        ? { ...item, layers: item.layers.map(item => item.id === layerId ? replacement : item) }
        : item),
    })),
  }
}

/** Commit manuscript changes and transfer only PNGs referenced by an authorized project. */
export class ComicProduction extends TypertRemoteService {
  static inject = ['storageDomain', 'workspaceRegistry']

  /** Loader configuration for the private image store and manuscript admission limits. */
  static Config: s<Config> = s.object({
    dshHome: s.string().default(''),
    maxImageBytes: s.number().step(1).min(1).max(32 * 1024 * 1024).default(defaults.maxImageBytes),
    maxImagePixels: s.number().step(1).min(1).max(64 * 1024 * 1024).default(defaults.maxImagePixels),
    maxProjectBytes: s.number().step(1).min(1024).max(4 * 1024 * 1024).default(defaults.maxProjectBytes),
    maxPackageBytes: s.number().step(1).min(1024).max(64 * 1024 * 1024).default(defaults.maxPackageBytes),
  })

  private readonly images: ComicImages
  private readonly limits: typeof defaults
  private readonly operations = new Set<Promise<unknown>>()
  private table?: KvTable<ComicProjectId, ComicProject>
  private closing = false

  /**
   * @param ctx - context providing the Workspace registry and persistent storage.
   * @param config - optional deployment overrides for paths and admission limits.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'comicProduction')
    const resolved = ComicProduction.Config(config)
    this.limits = { ...defaults, ...resolved }
    this.images = new ComicImages(join(resolveDshHome(resolved.dshHome || undefined), 'comic-production', 'originals'))
  }

  /** Open the original PNG store and the project table before publishing the service. */
  protected async [Service.init](): Promise<void> {
    await this.images.start()
    const domain = await this.ctx.storageDomain.open(comicProductionDomain)
    this.table = domain.table('projects')
    this.ctx.effect(() => async () => {
      this.closing = true
      await Promise.allSettled(this.operations)
      await domain.close()
    }, 'comic manuscript operations and storage')
  }

  /**
   * List manuscripts in the Workspace that owns the Session.
   * @param sessionId - attached Session opening the workbench.
   * @param signal - cancellation before reading the project list.
   * @returns the Workspace's project titles and revisions.
   */
  @Remote('list')
  list(sessionId: SessionId, signal?: AbortSignal): ComicProjectSummary[] {
    signal?.throwIfAborted()
    const workspaceId = this.workspace(sessionId)
    return [...this.projectTable().entries()].reverse().flatMap(([, project]) => project.workspaceId === workspaceId
      ? [{ id: project.id, title: project.title, revision: project.revision }] : [])
  }

  /**
   * Create a manuscript with three editable pages in the Session's Workspace.
   * @param sessionId - attached Session selecting the owner Workspace.
   * @param title - user-supplied manuscript title.
   * @param signal - cancellation before creating the project.
   * @returns the committed initial project.
   */
  @Remote('create')
  create(sessionId: SessionId, title: string, signal?: AbortSignal): Promise<ComicProject> {
    return this.run(async () => {
      signal?.throwIfAborted()
      const parsed = projectTitle.safeParse(title)
      if (!parsed.success) failure('title-invalid', 'A project title must contain 1–160 characters.')
      return await this.createProject(this.workspace(sessionId), initialDraft(parsed.data))
    })
  }

  /**
   * Open the current revision of a project in the Session's Workspace.
   * @param sessionId - attached Session selecting the owner Workspace.
   * @param projectId - stable project identity from the picker.
   * @param signal - cancellation before reading the project.
   * @returns the committed project, including retained artwork references.
   */
  @Remote('open')
  open(sessionId: SessionId, projectId: ComicProjectId, signal?: AbortSignal): ComicProject {
    signal?.throwIfAborted()
    const workspaceId = this.workspace(sessionId)
    const project = this.projectTable().get(projectId)
    if (project?.workspaceId !== workspaceId) failure('project-not-found', 'The manuscript is not in this Workspace.')
    return project
  }

  /**
   * Save complete editable geometry, dialogue, and adopted versions in one revision.
   * @param sessionId - attached Session selecting the owner Workspace.
   * @param projectId - project to edit.
   * @param revision - expected committed project revision.
   * @param draft - editable values; retained artwork references must match the current project.
   * @param signal - cancellation before the revision starts committing.
   * @returns the new committed project.
   */
  @Remote('save')
  save(sessionId: SessionId, projectId: ComicProjectId, revision: number, draft: ComicDraft, signal?: AbortSignal): Promise<ComicProject> {
    return this.run(async () => {
      signal?.throwIfAborted()
      const parsed = draftSchema.safeParse(draft)
      if (!parsed.success) failure('draft-invalid', 'The manuscript fields or counts are invalid.')
      this.checkDraft(parsed.data)
      this.open(sessionId, projectId)
      return await this.projectTable().update(projectId, (project) => {
        signal?.throwIfAborted()
        this.open(sessionId, projectId)
        checkRevision(project, revision)
        checkArtworkHistory(project, parsed.data)
        return { ...project, ...parsed.data, revision: project.revision + 1 }
      })
    })
  }

  /**
   * Publish a byte-exact PNG and adopt it as a new layer revision.
   * @param sessionId - attached Session selecting the owner Workspace.
   * @param projectId - project receiving the image.
   * @param revision - expected committed project revision.
   * @param panelId - panel containing the target layer.
   * @param layerId - target layer identity.
   * @param pngBase64 - base64 of the original PNG, at the layer's original dimensions on replacement.
   * @param signal - cancellation before the project revision starts committing.
   * @returns the committed project with all previous versions retained.
   */
  @Remote('saveLayerImage')
  saveLayerImage(
    sessionId: SessionId, projectId: ComicProjectId, revision: number, panelId: ComicPanelId, layerId: ComicLayerId,
    pngBase64: string, signal?: AbortSignal,
  ): Promise<ComicProject> {
    return this.run(async () => {
      const project = this.open(sessionId, projectId, signal)
      checkRevision(project, revision)
      const image = await prepareImage(pngBase64, this.limits.maxImageBytes, this.limits.maxImagePixels)
      signal?.throwIfAborted()
      const draft = withArtwork(project, panelId, layerId, image.ref)
      this.checkDraft(draft)
      checkRevision(this.open(sessionId, projectId), revision)
      await this.images.put(image)
      return await this.projectTable().update(projectId, (current) => {
        signal?.throwIfAborted()
        this.open(sessionId, projectId)
        checkRevision(current, revision)
        return { ...current, ...draft, revision: current.revision + 1 }
      })
    })
  }

  /**
   * Read a bounded slice from a retained artwork version in an authorized manuscript.
   * @param sessionId - attached Session selecting the owner Workspace.
   * @param projectId - project referencing the original image.
   * @param imageId - content identity from a retained layer version.
   * @param offset - zero-based raw byte position.
   * @param length - number of requested raw bytes, at most 256 KiB.
   * @param signal - cancellation before delivering the image slice.
   * @returns the original byte slice, including exact progress.
   */
  @Remote('readImage')
  readImage(
    sessionId: SessionId, projectId: ComicProjectId, imageId: ComicImageId, offset: number, length: number, signal?: AbortSignal,
  ): Promise<ComicImageChunk> {
    return this.run(async () => {
      const ref = imagesOf(this.open(sessionId, projectId, signal)).get(imageId)
      if (ref === undefined) failure('image-not-found', 'This manuscript does not reference the original PNG.')
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > ref.bytes
        || !Number.isSafeInteger(length) || length < 1 || length > maxSlice) failure('range-invalid', 'The image read range is invalid.')
      const chunk = await this.images.readChunk(ref, offset, length)
      signal?.throwIfAborted()
      return chunk
    })
  }

  /**
   * Freeze a portable project package with all retained original images.
   * @param sessionId - attached Session selecting the owner Workspace.
   * @param projectId - project to package.
   * @param signal - cancellation before delivering the package.
   * @returns editable manuscript data and verified original PNGs.
   */
  @Remote('exportProject')
  exportProject(sessionId: SessionId, projectId: ComicProjectId, signal?: AbortSignal): Promise<ComicProjectPackage> {
    return this.run(async () => {
      const project = this.open(sessionId, projectId, signal)
      this.checkDraft(project)
      const images: ComicProjectPackage['images'][number][] = []
      for (const ref of imagesOf(project).values()) {
        const data = await this.images.read(ref)
        signal?.throwIfAborted()
        images.push({ id: ref.id, data: data.toString('base64') })
      }
      return packageEnvelope(project, images)
    })
  }

  /**
   * Validate and import a portable project into the current Workspace as a new project.
   * @param sessionId - attached Session selecting the destination Workspace.
   * @param data - portable draft and its complete original-image set.
   * @param signal - cancellation before the project starts committing.
   * @returns the independently editable imported project.
   */
  @Remote('importProject')
  importProject(sessionId: SessionId, data: ComicProjectPackage, signal?: AbortSignal): Promise<ComicProject> {
    return this.run(async () => {
      signal?.throwIfAborted()
      const workspaceId = this.workspace(sessionId)
      const parsed = packageSchema.safeParse(data)
      if (!parsed.success) failure('package-invalid', 'The file is not a supported DSH comic project.')
      const { draft, images } = parsed.data
      this.checkDraft(draft)
      const refs = imagesOf(draft)
      if (refs.size !== images.length) failure('package-images', 'The project package must include each referenced image exactly once.')
      const skeleton = packageEnvelope(draft, images.map(({ id }) => ({ id, data: '' })))
      const encodedBytes = images.reduce((sum, image) => sum + image.data.length, Buffer.byteLength(JSON.stringify(skeleton)))
      if (encodedBytes > this.limits.maxPackageBytes) failure('package-size', 'The comic package exceeds its configured size limit.')
      const prepared: PreparedImage[] = []
      for (const { id, data: png } of images) {
        const expected = refs.get(id)
        if (expected === undefined) failure('package-images', 'The project package contains an unknown or repeated image.')
        const image = await prepareImage(png, this.limits.maxImageBytes, this.limits.maxImagePixels)
        signal?.throwIfAborted()
        if (!sameImage(expected, image.ref)) failure('package-images', 'An original PNG does not match its recorded identity or dimensions.')
        refs.delete(id)
        prepared.push(image)
      }
      for (const image of prepared) {
        await this.images.put(image)
        signal?.throwIfAborted()
      }
      if (this.workspace(sessionId) !== workspaceId) failure('workspace-changed', 'The Session moved to another Workspace during import.')
      return await this.createProject(workspaceId, draft)
    })
  }

  private projectTable(): KvTable<ComicProjectId, ComicProject> {
    if (this.table === undefined) throw new Error('Comic storage is not ready.')
    return this.table
  }

  private workspace(sessionId: SessionId): WorkspaceId {
    const workspace = this.ctx.workspaceRegistry.list().find(item => item.sessionIds.includes(sessionId))
    if (workspace === undefined) failure('workspace-required', 'Open the comic workbench from a Session in a Workspace.')
    return workspace.id
  }

  private async createProject(workspaceId: WorkspaceId, draft: ComicDraft): Promise<ComicProject> {
    this.checkDraft(draft)
    const id = brandString<ComicProjectId>(randomUUID())
    const project = { id, workspaceId, revision: 1, ...snapshot(draft) }
    await this.projectTable().put(id, project)
    return project
  }

  private checkDraft(draft: ComicDraft): void {
    const problem = draftProblem(draft)
    if (problem !== undefined) failure('draft-invalid', problem)
    if (Buffer.byteLength(JSON.stringify(snapshot(draft))) > this.limits.maxProjectBytes) {
      failure('draft-size', 'The manuscript metadata exceeds its configured size limit.')
    }
    const refs = [...imagesOf(draft).values()]
    const skeleton = packageEnvelope(draft, refs.map(({ id }) => ({ id, data: '' })))
    const bytes = refs.reduce((sum, ref) => sum + Math.ceil(ref.bytes / 3) * 4, Buffer.byteLength(JSON.stringify(skeleton)))
    if (bytes > this.limits.maxPackageBytes) failure('package-size', 'The manuscript and retained originals exceed its configured package limit.')
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) failure('service-closing', 'The manuscript service is closing.')
    const result = operation()
    this.operations.add(result)
    try {
      return await result
    } finally {
      this.operations.delete(result)
    }
  }
}

export default ComicProduction
