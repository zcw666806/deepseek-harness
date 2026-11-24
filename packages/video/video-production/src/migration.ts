/** Bounded, Session-owned project-package transfers with verified raw media frames. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, open, rm } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentId, ImageAttachmentRef, VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parsePortableCapabilityManifest } from '@deepseek-ai/dsh-capability-manager'
import type { PortableCapabilityManifest } from '@deepseek-ai/dsh-capability-manager'
import { z } from 'zod'
import { VideoProjectTransferId } from './brand.ts'
import type { ResolvedConfig } from './config.ts'
import { imageReference, projectRecord, videoReference, type ProjectRow } from './spec.ts'
import type {
  VideoProject, VideoProjectImportResult, VideoProjectRequirement, VideoProjectTransfer,
  VideoProjectTransferChunk, VideoProjectTransferId as TransferId,
} from './types.ts'

const MAGIC = Buffer.from('DSHVIDEO1\n', 'ascii')
const CHUNK_BYTES = 256 * 1024
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const mediaSchema = z.object({
  ref: z.union([imageReference, videoReference]), sha256: hash,
}).strict()
const requirementSchema = z.object({ generator: z.string().min(1), model: z.string().optional(), revision: z.string().optional() }).strict()
const portableProjectSchema = z.object({
  title: z.string().min(1), assets: z.array(z.unknown()), shots: z.array(z.unknown()), exports: z.array(z.unknown()),
}).strict()
const manifestSchema = z.object({
  format: z.literal('dsh-video-project'), version: z.literal(1), project: portableProjectSchema,
  media: z.array(mediaSchema), requirements: z.array(requirementSchema),
  capabilities: z.unknown().transform(parsePortableCapabilityManifest).optional(),
}).strict()
type MediaRef = ImageAttachmentRef | VideoAttachmentRef
type Manifest = z.infer<typeof manifestSchema>

interface Owner {
  load(sessionId: SessionId): Promise<ProjectRow>
  restore(project: VideoProject, sessionCreatedAt: number, signal: AbortSignal): Promise<VideoProject>
}

interface Transfer {
  readonly ticket: VideoProjectTransfer
  readonly sessionId: SessionId
  readonly sessionCreatedAt: number
  readonly root: string
  readonly path: string
  readonly controller: AbortController
  readonly timer: ReturnType<typeof setTimeout>
  nextOffset: number
}

function packageError(message: string): never { throw new Error(`VIDEO_PROJECT_PACKAGE: ${message}`) }

function references(project: VideoProject): MediaRef[] {
  const unique = new Map<AttachmentId, MediaRef>()
  const add = (ref: MediaRef): void => {
    const prior = unique.get(ref.attachmentId)
    if (prior !== undefined && (prior.mediaType !== ref.mediaType || prior.bytes !== ref.bytes)) packageError('A media identity has inconsistent metadata.')
    if (prior === undefined) unique.set(ref.attachmentId, ref)
  }
  for (const asset of project.assets) if (asset.image !== undefined) add(asset.image)
  for (const shot of project.shots) for (const version of shot.versions) {
    for (const image of version.referenceImages) add(image)
    if (version.attachment !== undefined) add(version.attachment)
  }
  for (const film of project.exports) if (film.attachment !== undefined) add(film.attachment)
  return [...unique.values()]
}

function requirements(project: VideoProject): VideoProjectRequirement[] {
  const unique = new Map<string, VideoProjectRequirement>()
  for (const shot of project.shots) for (const version of shot.versions) {
    if (version.generator === undefined) continue
    const item = {
      generator: version.generator,
      ...version.model === undefined ? {} : { model: version.model },
      ...version.generatorRevision === undefined ? {} : { revision: version.generatorRevision },
    }
    unique.set(JSON.stringify(item), item)
  }
  return [...unique.values()]
}

function portableReference<T extends MediaRef>(ref: T): T {
  return { ...ref, ...ref.name === undefined ? {} : { name: ref.name.split(/[\\/]/).at(-1) ?? '' } }
}

function detachedProject(project: VideoProject): Manifest['project'] {
  return {
    title: project.title, assets: project.assets.map(asset => ({
      ...asset, ...asset.image === undefined ? {} : { image: portableReference(asset.image) },
    })),
    shots: project.shots.map(shot => ({
      ...shot, versions: shot.versions.map(({ error: _error, ...version }) => ({
        ...version, referenceImages: version.referenceImages.map(portableReference),
        ...version.attachment === undefined ? {} : { attachment: portableReference(version.attachment) },
      })),
    })),
    exports: project.exports.map(({ error: _error, ...film }) => ({
      ...film, ...film.attachment === undefined ? {} : { attachment: portableReference(film.attachment) },
    })),
  }
}

function verifyRelationships(project: VideoProject, config: ResolvedConfig): void {
  if (project.assets.length > config.maxAssets || project.shots.length > config.maxShots || project.exports.length > config.maxExports
    || project.shots.some(shot => shot.versions.length > config.maxVersionsPerShot)) packageError('The project exceeds configured record limits.')
  if (project.shots.some(shot => (shot.edit?.captions?.length ?? 0) > config.maxCaptionsPerShot)
    || project.exports.some(film => film.clipEdits?.some(edit => (edit?.captions?.length ?? 0) > config.maxCaptionsPerShot))) {
    packageError('A clip exceeds maxCaptionsPerShot.')
  }
  const assets = new Set(project.assets.map(asset => asset.id))
  if (assets.size !== project.assets.length || new Set(project.shots.map(shot => shot.id)).size !== project.shots.length) packageError('Project asset and shot identities must be unique.')
  const versions = new Set<string>()
  for (const shot of project.shots) {
    if (new Set(shot.assetIds).size !== shot.assetIds.length || shot.assetIds.some(id => !assets.has(id))) packageError('A shot references an absent or duplicate asset.')
    for (const version of shot.versions) {
      if (versions.has(version.id)) packageError('Attempt identities must be unique across the project.')
      versions.add(version.id)
      if (version.status === 'completed' && version.attachment === undefined) packageError('A completed version must contain media.')
    }
    if (shot.selectedVersionId !== undefined && !shot.versions.some(version => version.id === shot.selectedVersionId
      && version.status === 'completed' && version.attachment !== undefined)) packageError('The selected version must be completed and belong to its shot.')
  }
  for (const film of project.exports) {
    if (versions.has(film.id)) packageError('Attempt identities must be unique across the project.')
    versions.add(film.id)
    if (film.shotVersionIds.length === 0 || new Set(film.shotVersionIds).size !== film.shotVersionIds.length) packageError('A film must contain distinct source-version identities.')
    if (film.clipEdits !== undefined && film.clipEdits.length !== film.shotVersionIds.length) packageError('Film edits must match its source-version identities.')
    if (film.status === 'completed' && film.attachment === undefined) packageError('A completed film must contain media.')
  }
  if (Buffer.byteLength(JSON.stringify(project)) > config.maxProjectBytes) packageError('The restored project exceeds maxProjectBytes.')
}

function targetProject(manifest: Manifest, target: VideoProject, config: ResolvedConfig): VideoProject {
  if (manifest.capabilities !== undefined && manifest.capabilities.capabilities.length > 256) packageError('The capability manifest exceeds 256 entries.')
  const parsed = projectRecord.parse({ ...manifest.project, id: target.id, sessionId: target.sessionId, revision: 1 })
  verifyRelationships(parsed, config)
  const expected = new Map(references(parsed).map(ref => [ref.attachmentId, ref]))
  if (expected.size !== manifest.media.length) packageError('The manifest must contain exactly its referenced media.')
  for (const item of manifest.media) {
    const ref = expected.get(item.ref.attachmentId)
    if (ref === undefined || JSON.stringify(ref) !== JSON.stringify(item.ref)) packageError('Media metadata does not match its project references.')
    expected.delete(item.ref.attachmentId)
  }
  if (expected.size !== 0 || JSON.stringify(requirements(parsed)) !== JSON.stringify(manifest.requirements)) packageError('The manifest requirements do not match the recorded project.')
  return parsed
}

async function writeAll(file: FileHandle, bytes: Uint8Array, position: number, signal: AbortSignal): Promise<void> {
  let offset = 0
  while (offset < bytes.length) {
    signal.throwIfAborted()
    const written = await file.write(bytes, offset, bytes.length - offset, position + offset)
    if (written.bytesWritten === 0) packageError('The package file could not be written.')
    offset += written.bytesWritten
  }
}

async function readAll(file: FileHandle, length: number, position: number, signal: AbortSignal): Promise<Buffer> {
  const bytes = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    signal.throwIfAborted()
    const part = await file.read(bytes, offset, length - offset, position + offset)
    if (part.bytesRead === 0) packageError('The package is truncated.')
    offset += part.bytesRead
  }
  return bytes
}

async function readMedia(ctx: Context, ref: MediaRef, signal: AbortSignal): Promise<Uint8Array> {
  return ref.mediaType === 'video/mp4' || ref.mediaType === 'video/webm'
    ? (await ctx.attachments.readVideo(ref, signal)).data
    : (await ctx.attachments.readImage(ref as ImageAttachmentRef, signal)).data
}

/** Private transfer owner; project mutations remain serialized by the production service. */
export class ProjectTransfers {
  private readonly entries = new Map<TransferId, Transfer>()
  private tail: Promise<void> = Promise.resolve()
  private readonly lifetime = new AbortController()
  private closing = false

  /**
   * @param ctx - durable attachment and logging services.
   * @param config - package resource limits.
   * @param owner - project lifecycle and commit operations.
   */
  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig, private readonly owner: Owner) {}

  /** Abort pending work and remove private transfer files only after all operations settle. */
  async close(): Promise<void> {
    this.closing = true
    this.lifetime.abort(new Error('Project transfers are unloading.'))
    await this.tail
    await Promise.all([...this.entries.values()].map(entry => this.drop(entry)))
  }

  /**
   * Capture an immutable project and its media in one bounded download package.
   * @param sessionId - Owning source Session.
   * @param signal - Cancellation through package creation and file preparation.
   * @returns The Session-bound downloadable package ticket.
   */
  prepareExport(sessionId: SessionId, signal: AbortSignal): Promise<VideoProjectTransfer> {
    return this.run(signal, async (active) => {
      const row = await this.owner.load(sessionId)
      if (row.project.revision === 0) packageError('Save a project before exporting it.')
      const entry = await this.create(sessionId, row.sessionCreatedAt, 'export', 0, active)
      const operation = AbortSignal.any([active, entry.controller.signal])
      try {
        const file = await open(entry.path, 'r+')
        let rawBytes = 0
        const media: Manifest['media'] = []
        try {
          for (const ref of references(row.project)) {
            operation.throwIfAborted()
            if (rawBytes + ref.bytes > this.config.maxProjectPackageBytes) packageError('Media exceeds maxProjectPackageBytes.')
            const bytes = await readMedia(this.ctx, ref, operation)
            if (bytes.byteLength !== ref.bytes) packageError('Stored media length does not match its reference.')
            await writeAll(file, bytes, rawBytes, operation)
            rawBytes += bytes.byteLength
            media.push({ ref: portableReference(ref), sha256: createHash('sha256').update(bytes).digest('hex') })
          }
          const capabilityManager = this.ctx.get('capabilities')
          const capabilities: PortableCapabilityManifest | undefined = capabilityManager === undefined ? undefined
            : parsePortableCapabilityManifest(await capabilityManager.exportManifest(operation))
          const manifest: Manifest = {
            format: 'dsh-video-project', version: 1, project: detachedProject(row.project), media, requirements: requirements(row.project),
            ...capabilities === undefined ? {} : { capabilities },
          }
          const header = Buffer.from(JSON.stringify(manifest))
          if (header.length > this.config.maxProjectPackageManifestBytes) packageError('The package manifest exceeds its byte limit.')
          const prefix = Buffer.alloc(MAGIC.length + 4 + header.length)
          MAGIC.copy(prefix)
          prefix.writeUInt32BE(header.length, MAGIC.length)
          header.copy(prefix, MAGIC.length + 4)
          if (prefix.length + rawBytes > this.config.maxProjectPackageBytes) packageError('The complete package exceeds maxProjectPackageBytes.')
          // Backward copies preserve unread bytes while making room for the bounded manifest.
          for (let remaining = rawBytes; remaining > 0;) {
            const count = Math.min(CHUNK_BYTES, remaining)
            remaining -= count
            const part = await readAll(file, count, remaining, operation)
            await writeAll(file, part, remaining + prefix.length, operation)
          }
          await writeAll(file, prefix, 0, operation)
          operation.throwIfAborted()
          const current = await this.owner.load(sessionId)
          if (current.sessionCreatedAt !== row.sessionCreatedAt) packageError('The source Session lifecycle changed during export.')
          const ticket = { ...entry.ticket, bytes: prefix.length + rawBytes }
          this.entries.set(entry.ticket.id, { ...entry, ticket })
          return ticket
        } finally { await file.close() }
      } catch (error) { await this.drop(entry); throw error }
    })
  }

  /**
   * Reserve a bounded package upload for an existing empty target project.
   * @param sessionId - target Session.
   * @param bytes - declared complete package size.
   * @param signal - caller cancellation.
   * @returns an empty upload ticket.
   */
  beginImport(sessionId: SessionId, bytes: number, signal: AbortSignal): Promise<VideoProjectTransfer> {
    return this.run(signal, async (active) => {
      if (!Number.isSafeInteger(bytes) || bytes < MAGIC.length + 4 || bytes > this.config.maxProjectPackageBytes) packageError('The declared package size is invalid or exceeds its byte limit.')
      const row = await this.owner.load(sessionId)
      if (row.project.revision !== 0) packageError('Restore requires a Session without an existing saved project.')
      return (await this.create(sessionId, row.sessionCreatedAt, 'import', bytes, active)).ticket
    })
  }

  /**
   * Read one authorized package slice without exposing a host file path.
   * @param sessionId - owning Session.
   * @param id - download ticket.
   * @param offset - raw byte offset.
   * @param length - requested bytes, at most 256 KiB.
   * @param signal - caller cancellation.
   * @returns a bounded base64 package slice.
   */
  read(sessionId: SessionId, id: TransferId, offset: number, length: number, signal: AbortSignal): Promise<VideoProjectTransferChunk> {
    return this.run(signal, async (active) => {
      const entry = await this.entry(sessionId, id, 'export')
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= entry.ticket.bytes || !Number.isSafeInteger(length) || length < 1 || length > CHUNK_BYTES) packageError('Invalid package byte range.')
      const nextOffset = Math.min(offset + length, entry.ticket.bytes)
      const file = await open(entry.path, 'r')
      try {
        const bytes = await readAll(file, nextOffset - offset, offset, AbortSignal.any([active, entry.controller.signal]))
        return { offset, nextOffset, totalBytes: entry.ticket.bytes, data: bytes.toString('base64') }
      } finally { await file.close() }
    })
  }

  /**
   * Append the exact next validated upload slice under serialized ticket ownership.
   * @param sessionId - owning target Session.
   * @param id - upload ticket.
   * @param offset - exact next raw byte position.
   * @param data - canonical base64, at most 256 KiB decoded.
   * @param signal - caller cancellation.
   * @returns the updated upload ticket.
   */
  write(sessionId: SessionId, id: TransferId, offset: number, data: string, signal: AbortSignal): Promise<VideoProjectTransfer> {
    return this.run(signal, async (active) => {
      const entry = await this.entry(sessionId, id, 'import')
      if (typeof data !== 'string' || data.length > Math.ceil(CHUNK_BYTES / 3) * 4) packageError('The upload slice exceeds 256 KiB.')
      const bytes = Buffer.from(data, 'base64')
      if (bytes.length === 0 || bytes.length > CHUNK_BYTES || bytes.toString('base64') !== data
        || offset !== entry.nextOffset || offset + bytes.length > entry.ticket.bytes) packageError('The upload slice or byte offset is invalid.')
      const file = await open(entry.path, 'r+')
      try { await writeAll(file, bytes, offset, AbortSignal.any([active, entry.controller.signal])) } finally { await file.close() }
      entry.nextOffset += bytes.length
      return { ...entry.ticket, nextOffset: entry.nextOffset }
    })
  }

  /**
   * Validate the complete package before admitting media and committing the target project.
   * @param sessionId - target Session.
   * @param id - complete upload ticket.
   * @param signal - caller cancellation.
   * @returns the atomically restored project and declarative generation requirements.
   */
  commit(sessionId: SessionId, id: TransferId, signal: AbortSignal): Promise<VideoProjectImportResult> {
    return this.run(signal, async (active) => {
      const entry = await this.entry(sessionId, id, 'import')
      const operation = AbortSignal.any([active, entry.controller.signal])
      try {
        if (entry.nextOffset !== entry.ticket.bytes) packageError('Upload every package byte before restoring.')
        const row = await this.owner.load(sessionId)
        if (row.project.revision !== 0) packageError('Restore requires a Session without an existing saved project.')
        const file = await open(entry.path, 'r')
        try {
          const prefix = await readAll(file, MAGIC.length + 4, 0, operation)
          if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) packageError('Unsupported project package format.')
          const headerBytes = prefix.readUInt32BE(MAGIC.length)
          if (headerBytes > this.config.maxProjectPackageManifestBytes || headerBytes < 2 || prefix.length + headerBytes > entry.ticket.bytes) packageError('Invalid package manifest size.')
          const rawHeader = await readAll(file, headerBytes, prefix.length, operation)
          const manifest = manifestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawHeader)) as unknown)
          const project = targetProject(manifest, row.project, this.config)
          let offset = prefix.length + headerBytes
          const mediaOffsets: number[] = []
          for (const item of manifest.media) {
            if (offset + item.ref.bytes > entry.ticket.bytes) packageError('Media frames exceed the package length.')
            mediaOffsets.push(offset)
            const digest = createHash('sha256')
            for (let count = 0; count < item.ref.bytes;) {
              const part = await readAll(file, Math.min(CHUNK_BYTES, item.ref.bytes - count), offset + count, operation)
              digest.update(part)
              count += part.length
            }
            if (digest.digest('hex') !== item.sha256) packageError('A media frame failed its SHA-256 check.')
            offset += item.ref.bytes
          }
          if (offset !== entry.ticket.bytes) packageError('The package contains unreferenced trailing bytes.')
          const restored = new Map<AttachmentId, MediaRef>()
          for (const [index, item] of manifest.media.entries()) {
            const position = mediaOffsets[index]
            if (position === undefined) packageError('A media frame has no position.')
            const data = await readAll(file, item.ref.bytes, position, operation)
            const ref = item.ref
            const saved = ref.mediaType === 'video/mp4' || ref.mediaType === 'video/webm'
              ? await this.ctx.attachments.saveVideo({ data, mediaType: ref.mediaType,
                ...ref.name === undefined ? {} : { name: ref.name },
                ...ref.width === undefined ? {} : { width: ref.width }, ...ref.height === undefined ? {} : { height: ref.height },
                ...ref.durationSeconds === undefined ? {} : { durationSeconds: ref.durationSeconds } }, operation)
              : await this.ctx.attachments.saveImage({
                data, mediaType: ref.mediaType, ...ref.name === undefined ? {} : { name: ref.name },
              })
            operation.throwIfAborted()
            restored.set(ref.attachmentId, saved)
          }
          const image = (ref: ImageAttachmentRef): ImageAttachmentRef => {
            const { name: _name, ...saved } = restored.get(ref.attachmentId) as ImageAttachmentRef
            return { ...saved,
              ...ref.name === undefined ? {} : { name: ref.name.split(/[\\/]/).at(-1) ?? '' },
              ...ref.originalDimensions === undefined ? {} : { originalDimensions: ref.originalDimensions },
            }
          }
          const video = (ref: VideoAttachmentRef): VideoAttachmentRef => {
            const saved = restored.get(ref.attachmentId) as VideoAttachmentRef
            return { ...ref, attachmentId: saved.attachmentId, bytes: saved.bytes,
              ...ref.name === undefined ? {} : { name: ref.name.split(/[\\/]/).at(-1) ?? '' } }
          }
          const imported: VideoProject = {
            ...project,
            assets: project.assets.map(asset => ({ ...asset, ...asset.image === undefined ? {} : { image: image(asset.image) } })),
            shots: project.shots.map(shot => ({ ...shot, versions: shot.versions.map(version => ({
              ...version, referenceImages: version.referenceImages.map(image),
              ...version.attachment === undefined ? {} : { attachment: video(version.attachment) },
              ...version.status === 'running'
                ? { status: 'interrupted' as const, error: 'Generation was in progress when this package was exported.' } : {},
            })) })),
            exports: project.exports.map(film => ({ ...film,
              ...film.attachment === undefined ? {} : { attachment: video(film.attachment) },
              ...film.status === 'running' ? { status: 'interrupted' as const, error: 'Export was in progress when this package was exported.' } : {},
            })),
          }
          operation.throwIfAborted()
          return {
            project: await this.owner.restore(imported, entry.sessionCreatedAt, operation),
            requirements: manifest.requirements.map(item => ({
              generator: item.generator, ...item.model === undefined ? {} : { model: item.model },
              ...item.revision === undefined ? {} : { revision: item.revision },
            })),
            ...manifest.capabilities === undefined ? {} : { capabilities: manifest.capabilities },
          }
        } finally { await file.close() }
      } finally { await this.drop(entry) }
    })
  }

  /**
   * Release a live owned ticket, or finish without changes when it is already absent.
   * @param sessionId - owning Session.
   * @param id - upload or download ticket.
   * @returns completion after its private temporary files are removed.
   */
  cancel(sessionId: SessionId, id: TransferId): Promise<void> {
    return this.run(undefined, async () => {
      await this.owner.load(sessionId)
      const entry = this.entries.get(id)
      if (entry === undefined) return
      if (entry.sessionId !== sessionId) packageError('This Session has no matching live project transfer.')
      await this.drop(entry)
    })
  }

  private run<T>(
    signal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Project transfers are unloading.'))
    const active = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    const result = this.tail.then(() => { active.throwIfAborted(); return action(active) })
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  private async create(sessionId: SessionId, sessionCreatedAt: number, direction: 'export' | 'import', bytes: number, signal: AbortSignal): Promise<Transfer> {
    if (this.entries.size >= this.config.maxProjectTransfers) packageError('The host has reached maxProjectTransfers.')
    signal.throwIfAborted()
    const root = await mkdtemp(join(tmpdir(), 'dsh-video-package-'))
    try {
      const path = join(root, 'project.dshvideo')
      const file = await open(path, 'wx', 0o600)
      await file.close()
      signal.throwIfAborted()
      const id = VideoProjectTransferId(randomUUID())
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort(new Error('The project transfer expired.'))
        void this.run(undefined, async () => {
          const entry = this.entries.get(id)
          if (entry !== undefined) await this.drop(entry)
        }).catch((error: unknown) => { this.ctx.logger.warn('Expired project-transfer cleanup failed: %s', error) })
      }, this.config.projectTransferTimeoutMs)
      timer.unref()
      const entry: Transfer = {
        ticket: { id, direction, bytes, nextOffset: 0, expiresAt: Date.now() + this.config.projectTransferTimeoutMs, fileName: 'project.dshvideo' },
        root, path, sessionId, sessionCreatedAt, controller, timer, nextOffset: 0,
      }
      this.entries.set(id, entry)
      return entry
    } catch (error) { await rm(root, { recursive: true, force: true, maxRetries: 3 }); throw error }
  }

  private async entry(sessionId: SessionId, id: TransferId, direction?: Transfer['ticket']['direction']): Promise<Transfer> {
    const entry = this.entries.get(id)
    if (entry === undefined || entry.sessionId !== sessionId || (direction !== undefined && entry.ticket.direction !== direction)) packageError('This Session has no matching live project transfer.')
    entry.controller.signal.throwIfAborted()
    const row = await this.owner.load(sessionId)
    if (row.sessionCreatedAt !== entry.sessionCreatedAt) packageError('The transfer belongs to an earlier Session lifecycle.')
    return entry
  }

  private async drop(entry: Transfer): Promise<void> {
    clearTimeout(entry.timer)
    entry.controller.abort(new Error('The project transfer has closed.'))
    this.entries.delete(entry.ticket.id)
    await rm(entry.root, { recursive: true, force: true, maxRetries: 3 })
  }
}
