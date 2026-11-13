/** Validation of tool input, media references, and durable project records. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AttachmentId, ImageAttachmentRef, VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { VideoAssetId, VideoProjectId, VideoShotId, VideoVersionId } from './brand.ts'
import type { VideoProject, VideoProjectInput } from './types.ts'

const identity = z.string().min(1).max(256)
const attachmentId = identity.transform(value => brandString<AttachmentId>(value))
const positive = z.number().int().positive()

/** User editing values, admitted independently of provider generation parameters. */
export const clipEdit = z.object({
  trimStartSeconds: z.number().nonnegative().optional(),
  trimEndSeconds: z.number().positive().optional(),
  volume: z.number().min(0).max(4).optional(),
  captions: z.array(z.object({
    startSeconds: z.number().nonnegative(), endSeconds: z.number().positive(),
    text: z.string().min(1).refine(value => !value.includes('\u0000'), 'Caption text cannot contain NUL.'),
  }).strict().refine(value => value.endSeconds > value.startSeconds, 'Caption end must follow its start.')).optional(),
}).strict().refine(value => value.trimEndSeconds === undefined || value.trimEndSeconds > (value.trimStartSeconds ?? 0),
  'Clip end must follow its start.')

/** Stored image metadata accepted only after session ownership is checked. */
export const imageReference: z.ZodType<ImageAttachmentRef> = z.object({
  attachmentId,
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  bytes: positive,
  width: positive,
  height: positive,
  name: z.string().optional(),
  originalDimensions: z.object({ width: positive, height: positive }).strict().optional(),
}).strict().transform(({ name, originalDimensions, ...required }) => ({
  ...required,
  ...name === undefined ? {} : { name },
  ...originalDimensions === undefined ? {} : { originalDimensions },
}))

/** Durable video metadata validated again at provider and storage boundaries. */
export const videoReference: z.ZodType<VideoAttachmentRef> = z.object({
  attachmentId,
  mediaType: z.enum(['video/mp4', 'video/webm']),
  bytes: positive,
  width: positive.optional(),
  height: positive.optional(),
  durationSeconds: z.number().positive().optional(),
  name: z.string().optional(),
}).strict()

const asset = z.object({
  id: identity.transform(VideoAssetId),
  name: z.string().min(1),
  kind: z.enum(['character', 'scene', 'prop']),
  description: z.string(),
  image: imageReference.optional(),
}).strict()

const shotFields = {
  id: identity.transform(VideoShotId),
  title: z.string().min(1),
  prompt: z.string().min(1),
  duration: z.number().int().min(1).max(15),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  resolution: z.enum(['480p', '720p']),
  assetIds: z.array(identity.transform(VideoAssetId)),
  position: z.object({ x: z.number(), y: z.number() }).strict(),
  selectedVersionId: identity.transform(VideoVersionId).optional(),
  edit: clipEdit.optional(),
} as const

const version = z.object({
  id: identity.transform(VideoVersionId),
  status: z.enum(['running', 'completed', 'failed', 'interrupted']),
  prompt: z.string(),
  duration: z.number().int().min(1).max(15),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  resolution: z.enum(['480p', '720p']),
  referenceImages: z.array(imageReference),
  generator: z.string().optional(),
  generatorTitle: z.string().optional(),
  generatorRevision: z.string().optional(),
  model: z.string().optional(),
  attachment: videoReference.optional(),
  error: z.string().optional(),
}).strict()

/** Complete editable replacement submitted through RPC or the model tool. */
export const projectInput: z.ZodType<VideoProjectInput> = z.object({
  revision: z.number().int().nonnegative(),
  title: z.string().min(1),
  assets: z.array(asset),
  shots: z.array(z.object(shotFields).strict()),
}).strict()

/** Stored project parser; data is not defaulted or migrated. */
export const projectRecord: z.ZodType<VideoProject> = z.object({
  id: identity.transform(VideoProjectId),
  sessionId: identity.transform(value => brandString<SessionId>(value)),
  revision: z.number().int().positive(),
  title: z.string().min(1),
  assets: z.array(asset),
  shots: z.array(z.object({ ...shotFields, versions: z.array(version) }).strict()),
  exports: z.array(z.object({
    id: identity.transform(VideoVersionId),
    status: z.enum(['running', 'completed', 'failed', 'interrupted']),
    shotVersionIds: z.array(identity.transform(VideoVersionId)),
    clipEdits: z.array(clipEdit.nullable()).optional(),
    attachment: videoReference.optional(),
    error: z.string().optional(),
  }).strict()),
}).strict()

/** Project plus the exact Session lifecycle that owns it. */
export interface ProjectRow {
  readonly sessionCreatedAt: number
  readonly project: VideoProject
}

/** One revisioned project per Session; backend selection belongs to storage-domain. */
export const videoProductionDomain = defineDomain({
  name: 'video_production',
  version: 1,
  tables: {
    projects: domainTable<SessionId, ProjectRow>(z.object({
      sessionCreatedAt: z.number().int().nonnegative(),
      project: projectRecord,
    }).strict()),
  },
})
