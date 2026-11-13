/** Durable missing-shot production batches owned by the Host. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { VideoGenerationSelection, VideoProjectId, VideoShotId, VideoVersionId } from './types.ts'

/** Identity protecting controls from replacing a newer production batch. */
export type VideoBatchId = Branded<'VideoBatchId'>

/** Observed project revision and explicit generation route for a missing-shot batch. */
export interface VideoBatchInput extends VideoGenerationSelection {
  readonly revision: number
}

/** Frozen generation input and its durable submission checkpoint. */
export interface VideoBatchShot {
  readonly shotId: VideoShotId
  readonly input: string
  readonly status: 'pending' | 'running' | 'completed' | 'uncertain'
  readonly versionId?: VideoVersionId | undefined
  readonly error?: string | undefined
}

/** Latest production batch for one Session lifecycle; pause and cancel stop at shot boundaries. */
export interface VideoBatch {
  readonly id: VideoBatchId
  readonly sessionId: SessionId
  readonly sessionCreatedAt: number
  readonly projectId: VideoProjectId
  readonly inputRevision: number
  readonly generator: string
  readonly model?: string | undefined
  readonly generatorRevision?: string | undefined
  readonly status: 'running' | 'pausing' | 'paused' | 'cancelling' | 'cancelled' | 'completed' | 'needs-review'
  readonly shots: readonly VideoBatchShot[]
  readonly error?: string | undefined
}

/** Atomic pre-submission check against the batch's captured project and provider. */
export interface VideoBatchGuard {
  readonly sessionCreatedAt: number
  readonly input: string
  readonly generatorRevision?: string | undefined
}
