/** Persistent video projects and the provider-facing generation request. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { EncodedImageAttachment, ImageAttachmentRef, VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PortableCapabilityManifest } from '@deepseek-ai/dsh-capability-manager'
export type * from './task-types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Rejected video-project operation with a stable domain-specific reason. */
    'video-production/invalid': { readonly reason: string }
  }
}

/** One Session-owned production project. */
export type VideoProjectId = Branded<'VideoProjectId'>
/** Stable identity of one reusable reference asset. */
export type VideoAssetId = Branded<'VideoAssetId'>
/** Stable identity of one storyboard shot. */
export type VideoShotId = Branded<'VideoShotId'>
/** Stable identity of one generated shot version or complete export. */
export type VideoVersionId = Branded<'VideoVersionId'>
/** Ephemeral identity of one bounded project-package upload or download. */
export type VideoProjectTransferId = Branded<'VideoProjectTransferId'>
/** Supported output frame proportions. */
export type VideoAspectRatio = '16:9' | '9:16' | '1:1'
/** Supported requested video resolution. */
export type VideoResolution = '480p' | '720p'

/** Literal caption text timed relative to the trimmed clip's first frame. */
export interface VideoCaption {
  readonly startSeconds: number
  readonly endSeconds: number
  readonly text: string
}

/** Non-destructive editing of an adopted video; generation inputs and source bytes are preserved. */
export interface VideoClipEdit {
  readonly trimStartSeconds?: number | undefined
  readonly trimEndSeconds?: number | undefined
  readonly volume?: number | undefined
  readonly captions?: readonly VideoCaption[] | undefined
}

/** Reusable character, scene, or prop reference supplied by the user. */
export interface VideoAsset {
  readonly id: VideoAssetId
  readonly name: string
  readonly kind: 'character' | 'scene' | 'prop'
  readonly description: string
  readonly image?: ImageAttachmentRef | undefined
}

/** Editable shot fields; generated versions are owned by the service. */
export interface VideoShotInput {
  readonly id: VideoShotId
  readonly title: string
  readonly prompt: string
  readonly duration: number
  readonly aspectRatio: VideoAspectRatio
  readonly resolution: VideoResolution
  readonly assetIds: readonly VideoAssetId[]
  readonly position: { readonly x: number; readonly y: number }
  readonly selectedVersionId?: VideoVersionId | undefined
  readonly edit?: VideoClipEdit | undefined
}

/** One persisted attempt, retaining its request when a later edit changes the shot. */
export interface VideoVersion {
  readonly id: VideoVersionId
  readonly status: 'running' | 'completed' | 'failed' | 'interrupted'
  readonly prompt: string
  readonly duration: number
  readonly aspectRatio: VideoAspectRatio
  readonly resolution: VideoResolution
  readonly referenceImages: readonly ImageAttachmentRef[]
  readonly generator?: string | undefined
  readonly generatorTitle?: string | undefined
  readonly generatorRevision?: string | undefined
  readonly model?: string | undefined
  readonly attachment?: VideoAttachmentRef | undefined
  readonly error?: string | undefined
}

/** One editable storyboard shot and all of its generation attempts. */
export interface VideoShot extends VideoShotInput {
  readonly versions: readonly VideoVersion[]
}

/** One exported film and the exact selected source versions it contains. */
export interface VideoExport {
  readonly id: VideoVersionId
  readonly status: 'running' | 'completed' | 'failed' | 'interrupted'
  readonly shotVersionIds: readonly VideoVersionId[]
  /** Editing values aligned with shotVersionIds; null means the complete source at its original volume. */
  readonly clipEdits?: readonly (VideoClipEdit | null)[] | undefined
  readonly attachment?: VideoAttachmentRef | undefined
  readonly error?: string | undefined
}

/** Durable project data. Array order is the film's shot order. */
export interface VideoProject {
  readonly id: VideoProjectId
  readonly sessionId: SessionId
  readonly revision: number
  readonly title: string
  readonly assets: readonly VideoAsset[]
  readonly shots: readonly VideoShot[]
  readonly exports: readonly VideoExport[]
}

/** Bounded presentation index for saved projects; the project service retains the complete title and data. */
export interface VideoProjectSummary {
  readonly sessionId: SessionId
  readonly projectId: VideoProjectId
  readonly revision: number
  readonly displayTitle: string
}

/** Optimistic replacement of editable project fields; omitted shots are deleted. */
export interface VideoProjectInput {
  readonly revision: number
  readonly title: string
  readonly assets: readonly VideoAsset[]
  readonly shots: readonly VideoShotInput[]
}

/** Explicit optional generation target and missing-shot admission condition. */
export interface VideoGenerationSelection {
  readonly generator?: string
  readonly model?: string
  /** Skip a queued generation when the current shot already has a completed video version. */
  readonly onlyIfMissing?: boolean
}

/** Provider-declared restrictions; omitted fields make no capability claim. */
export interface VideoGenerationLimits {
  readonly durations?: readonly number[]
  readonly aspectRatios?: readonly VideoAspectRatio[]
  readonly resolutions?: readonly VideoResolution[]
  readonly minReferenceImages?: number
  readonly maxReferenceImages?: number
}

/** One selectable configuration described by its owning generation provider. */
export interface VideoGeneratorDetails {
  readonly title: string
  readonly model?: string
  readonly revision?: string
  readonly limits?: VideoGenerationLimits
}

/** Current selectable generation configuration, without credentials or workflow contents. */
export interface VideoGenerationTarget extends VideoGeneratorDetails {
  readonly generator: string
}

/** Read current provider-owned configurations when listing or resolving an attempt. */
export type DescribeVideoGenerator = () => readonly VideoGeneratorDetails[]

/** Admit a new reference image and append its asset in one project mutation. */
export interface VideoAssetUpload {
  readonly revision: number
  readonly name: string
  readonly kind: 'character' | 'scene' | 'prop'
  readonly description: string
  readonly image: EncodedImageAttachment
}

/** Resolved request passed to one effect-owned generation provider. */
export interface VideoGenerationInput {
  readonly sessionId: SessionId
  readonly prompt: string
  readonly duration: number
  readonly aspectRatio: VideoAspectRatio
  readonly resolution: VideoResolution
  readonly referenceImages: readonly ImageAttachmentRef[]
  readonly model?: string
}

/** Persisted output returned by a generation provider. */
export interface VideoGenerationResult {
  readonly attachment: VideoAttachmentRef
  readonly model?: string
}

/** Generation provider observes cancellation and returns only after owned work settles. */
export type VideoGenerator = (
  request: VideoGenerationInput,
  signal: AbortSignal,
) => Promise<VideoGenerationResult>

/** One bounded authorized media slice; offsets count raw encoded bytes. */
export interface VideoMediaChunk {
  readonly attachment: ImageAttachmentRef | VideoAttachmentRef
  readonly data: string
  readonly offset: number
  readonly nextOffset: number
  readonly totalBytes: number
}

/** One model or workflow recorded by the project, without machine paths or credentials. */
export interface VideoProjectRequirement {
  readonly generator: string
  readonly model?: string
  readonly revision?: string
}

/** Ephemeral project-package transfer; clients persist the downloaded file, not this ticket. */
export interface VideoProjectTransfer {
  readonly id: VideoProjectTransferId
  readonly direction: 'export' | 'import'
  readonly bytes: number
  readonly nextOffset: number
  readonly expiresAt: number
  readonly fileName: string
}

/** One base64-encoded package slice; offsets and limits count decoded bytes. */
export interface VideoProjectTransferChunk {
  readonly data: string
  readonly offset: number
  readonly nextOffset: number
  readonly totalBytes: number
}

/** Restored project and its declarative generation requirements; no engine is installed or executed. */
export interface VideoProjectImportResult {
  readonly project: VideoProject
  readonly requirements: readonly VideoProjectRequirement[]
  readonly capabilities?: PortableCapabilityManifest
}

/** Deployment-specific bounds and the optional host-local export executable. */
export interface Config {
  /** Maximum storyboard shots per project; integer 1–256, default 64. */
  readonly maxShots?: number
  /** Maximum reusable reference assets per project; integer 1–256, default 64. */
  readonly maxAssets?: number
  /** Maximum retained generation attempts per shot, including failures; integer 1–256, default 20. */
  readonly maxVersionsPerShot?: number
  /** Maximum retained film-export attempts per project, including failures; integer 1–256, default 20. */
  readonly maxExports?: number
  /** Maximum timed captions on one adopted clip; integer 1–256, default 64. */
  readonly maxCaptionsPerShot?: number
  /** Maximum UTF-8 bytes in a complete serialized project; integer 1,024–16,777,216, default 1,048,576. */
  readonly maxProjectBytes?: number
  /** Host-local FFmpeg executable: absolute path or bare PATH name; default `ffmpeg`. */
  readonly ffmpegPath?: string
  /** Host-local ffprobe executable: absolute path or bare PATH name; default `ffprobe`. */
  readonly ffprobePath?: string
  /** Optional host-local subtitle font file; omitted uses the renderer's configured default font. */
  readonly subtitleFontPath?: string
  /**
   * Export cancellation deadline covering preparation, rendering, and attachment storage.
   * Integer milliseconds from 1 through 2,147,483,647; default 300,000.
   */
  readonly exportTimeoutMs?: number
  /**
   * Generation cancellation deadline covering the provider and attachment verification.
   * Integer milliseconds from 1 through 2,147,483,647; default 300,000.
   */
  readonly generationTimeoutMs?: number
  /** Normalized exported video width in pixels; even integer 2–4,096, default 1,280. */
  readonly exportWidth?: number
  /** Normalized exported video height in pixels; even integer 2–4,096, default 720. */
  readonly exportHeight?: number
  /** Normalized exported video frames per second; integer 1–120, default 24. */
  readonly exportFrameRate?: number
  /**
   * Byte limit for total source clips, each normalized clip, and the complete rendered MP4.
   * Integer from 1 through 2,147,483,647; default 536,870,912.
   */
  readonly maxExportBytes?: number
  /** Managed process-tree termination and pipe-draining grace in milliseconds; integer 1–2,147,483,647, default 2,000. */
  readonly processGraceMs?: number
  /** Maximum collected bytes per renderer stdout or stderr stream; integer 1–1,048,576, default 16,384. */
  readonly maxProcessOutputBytes?: number
  /** Maximum raw bytes in a complete portable project package; integer 1,024–2,147,483,647, default 805,306,368. */
  readonly maxProjectPackageBytes?: number
  /** Maximum UTF-8 bytes in a package manifest; integer 1,024–16,777,216, default 4,194,304. */
  readonly maxProjectPackageManifestBytes?: number
  /** Maximum simultaneous package transfers; integer 1–64, default 4. */
  readonly maxProjectTransfers?: number
  /** Package transfer lifetime in milliseconds; integer 1–2,147,483,647, default 1,800,000. */
  readonly projectTransferTimeoutMs?: number
}
