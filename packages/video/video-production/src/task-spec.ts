/** Strict storage validation for recoverable production batches. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { VideoProjectId, VideoShotId, VideoVersionId } from './brand.ts'
import type { VideoBatch, VideoBatchId } from './task-types.ts'

const id = z.string().min(1).max(256)

/** Durable descriptor; in-flight callbacks and credentials are never serialized. */
export const batchRecord: z.ZodType<VideoBatch> = z.object({
  id: id.transform(value => brandString<VideoBatchId>(value)),
  sessionId: id.transform(value => brandString<SessionId>(value)),
  sessionCreatedAt: z.number().int().nonnegative(),
  projectId: id.transform(VideoProjectId),
  inputRevision: z.number().int().positive(),
  generator: z.string().min(1), model: z.string().optional(), generatorRevision: z.string().optional(),
  status: z.enum(['running', 'pausing', 'paused', 'cancelling', 'cancelled', 'completed', 'needs-review']),
  shots: z.array(z.object({
    shotId: id.transform(VideoShotId), input: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'uncertain']),
    versionId: id.transform(VideoVersionId).optional(), error: z.string().optional(),
  }).strict()).max(256),
  error: z.string().optional(),
}).strict()

/** Separate versioned records preserve the existing project's storage format. */
export const videoBatchDomain = defineDomain({
  name: 'video_production_batches', version: 1,
  tables: { batches: domainTable<SessionId, VideoBatch>(batchRecord) },
})
