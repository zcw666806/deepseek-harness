/** Operator-owned workflow templates and bounded HTTP transport settings. */
import type { VideoAspectRatio, VideoResolution } from '@deepseek-ai/dsh-video-production/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Editable configuration failed endpoint, workflow, or revision validation. */
    'video-workflows/invalid': { readonly reason: 'configuration' }
    /** Workflow settings are absent from the active host composition. */
    'video-workflows/unavailable': { readonly reason: 'settings' }
    /** Another writer committed after the editor read its revision. */
    'video-workflows/conflict': { readonly expected: number; readonly actual: number }
    /** Persistent settings refused or failed the write. */
    'video-workflows/write-failed': { readonly reason: 'persistence' }
  }
}

/** One existing scalar input; node identities and input names never come from a model. */
export interface ScalarBinding {
  /** Existing API node identity; reserved JavaScript property names are rejected. */
  readonly node: string
  /** Existing scalar input name on that node; linked or missing inputs are rejected. */
  readonly input: string
}

/** Exact dimension pair supported by this operator's workflow. */
export interface WorkflowSize {
  /** Project aspect-ratio selection matched by this exact dimension pair. */
  readonly aspectRatio: VideoAspectRatio
  /** Project resolution selection matched by this exact dimension pair. */
  readonly resolution: VideoResolution
  /** Bound output width in pixels; integer 1–16,384. */
  readonly width: number
  /** Bound output height in pixels; integer 1–16,384. */
  readonly height: number
}

/** Explicit conversion from project seconds to a workflow's numeric duration input. */
export interface WorkflowDuration extends ScalarBinding {
  /** `seconds` passes the request unchanged; `frames` computes seconds × fps + frameOffset. */
  readonly unit: 'seconds' | 'frames'
  /** Positive finite frame multiplier; required for frames and forbidden for seconds. */
  readonly fps?: number | undefined
  /** Signed integer frame adjustment, default 0; frames only, and every declared duration must produce a positive whole frame count. */
  readonly frameOffset?: number | undefined
}

/** One selected raw history output; other node outputs are never downloaded. */
export interface WorkflowOutput {
  /** Existing API node identity whose successful history contains the video. */
  readonly node: string
  /** Raw output array key, for example `images` for the reviewed native SaveVideo node. */
  readonly key: string
  /** Zero-based integer index in that output array. */
  readonly index: number
}

/** API-format workflow and the only inputs the adapter can replace. */
export interface ComfyWorkflow {
  /** Unique nonempty letters/digits/underscore/hyphen identity exposed as the selectable model. */
  readonly id: string
  /** Nonempty operator-supplied target title shown without exposing the workflow contents. */
  readonly title: string
  /** API-format node dictionary containing class_type and inputs; frontend graph JSON is rejected. */
  readonly template: Readonly<Record<string, JsonValue>>
  /** Existing string scalar receiving only the resolved shot prompt. */
  readonly prompt: ScalarBinding
  /** Existing numeric scalar with an explicit seconds or frames conversion. */
  readonly duration: WorkflowDuration
  /** Existing numeric scalar receiving the width from the selected sizes entry. */
  readonly width: ScalarBinding
  /** Existing numeric scalar receiving the height from the selected sizes entry. */
  readonly height: ScalarBinding
  /** Ordered existing string scalars receiving uploaded image paths; the request must supply exactly this many images, including zero. */
  readonly references: readonly ScalarBinding[]
  /** Existing save-node prefix scalar receiving a private output directory to prevent cross-job overwrite. */
  readonly outputPrefix: ScalarBinding
  /** Nonempty unique integer durations in seconds, each from 1 through 15; no duration default is inferred. */
  readonly durations: readonly number[]
  /** Unique aspect-ratio/resolution pairs and exact dimensions; unsupported pairs are rejected before upload. */
  readonly sizes: readonly WorkflowSize[]
  /** Exact node, array key, and index in successful own-job history. */
  readonly output: WorkflowOutput
}

/** Editable workflow configuration; transport credentials and runtime bindings stay host-owned. */
export interface WorkflowConfiguration {
  /** HTTP(S) service URL without embedded credentials, query, or fragment. */
  readonly baseURL?: string
  /** Portable API workflows with explicit input and output bindings. */
  readonly workflows: readonly ComfyWorkflow[]
}

/** Safe settings snapshot used for optimistic configuration writes. */
export interface WorkflowConfigurationView {
  /** Settings namespace revision required for every write. */
  readonly revision: number
  /** Whether these workflows are registered as generation targets. */
  readonly enabled: boolean
  /** Editable fields without operation inputs, secrets, or machine paths. */
  readonly configuration: WorkflowConfiguration
  /** Whether host-owned request headers are configured; values are never returned. */
  readonly hasHeaders: boolean
  /** Reviewed starter workflows; diagnostic entries do not generate AI imagery. */
  readonly templates: readonly WorkflowStarterTemplate[]
}

/** Built-in workflow accompanied by its user-visible purpose. */
export interface WorkflowStarterTemplate {
  /** Distinguishes transport diagnostics from AI generation workflows. */
  readonly category: 'diagnostic'
  /** Complete API workflow ready for explicit operator selection. */
  readonly workflow: ComfyWorkflow
}

/** Optional provider; enabling it requires explicit endpoint and workflows. */
export interface Config {
  /** Register configured workflows when true; default false performs no network requests. */
  readonly enabled?: boolean
  /** Optional DSH capability identity to start before generation; omission leaves runtime management external. */
  readonly managedCapability?: string
  /** Operator-owned HTTP(S) origin with optional path prefix; required when enabled, no default. */
  readonly baseURL?: string
  /** Same-origin request headers, including optional proxy authorization; default empty. */
  readonly headers?: Readonly<Record<string, string>>
  /** Operator-authored API-format templates and explicit input/output bindings; default empty, required when enabled. */
  readonly workflows?: readonly ComfyWorkflow[]
  /** Total upload, submission, polling, download, and storage deadline; integer 1–2,147,483,647 ms, default 300,000. */
  readonly timeoutMs?: number
  /** Independent deadline for awaiting submission and cancelling only this operation's job; integer 1–2,147,483,647 ms, default 10,000. */
  readonly cleanupTimeoutMs?: number
  /** Interval between own-job history or cancellation checks; integer 1–2,147,483,647 ms, default 1,000. */
  readonly pollIntervalMs?: number
  /** Maximum encoded bytes per JSON request, JSON response, and serialized workflow; integer 1–16,777,216, default 1,048,576. */
  readonly maxJsonBytes?: number
  /** Maximum aggregate encoded reference-image upload bytes per attempt; integer 1–2,147,483,647, default 20,971,520. */
  readonly maxUploadBytes?: number
  /** Maximum downloaded video bytes; integer 1–2,147,483,647, default 536,870,912. */
  readonly maxVideoBytes?: number
}
