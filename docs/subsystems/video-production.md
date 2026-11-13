# Video production

English | [中文](video-production.zh.md)

The [video-production package](../../packages/video/video-production/README.md) owns one persistent project per Session. Its Service Definition, local project provider, model tools, and Remote consumer share a package because they evolve together. The [browser workspace](../../packages/client/ui-video-production/README.md) consumes the same project operations.

## Project data

[VideoProject](../../packages/video/video-production/src/types.ts) contains a branded identity, Session identity, optimistic revision, title, reusable assets, ordered shots, and film exports. `VideoAsset` identifies a character, scene, or prop and may reference an admitted image. `VideoShotInput` contains editable prompts, requested duration, frame proportions, resolution, asset references, and the selected output version. Array order defines film order; moving a canvas card alone does not change that order.

`VideoVersion` retains each attempt's prompt, status, generator identity and title, available generator configuration revision, model, attachment, and failure diagnostic. Historical attempts without generator metadata remain unknown. Failed retries preserve completed versions. `VideoExport` records the exact selected source versions used in a film. Running attempts recovered after a Host restart become interrupted; recovery does not silently submit another paid generation.

## Generation and export

`VideoClipEdit` records source-relative cuts, original audio volume and `VideoCaption` timing relative to the trimmed clip. Exports capture aligned editing values with their source-version identities. `VideoBatch` belongs to a Session lifecycle and retains frozen generation inputs and per-shot checkpoints in a separate storage domain. Recovery exposes uncertain submissions for review; explicit continuation submits only pending shots. The [package reference](../../packages/video/video-production/README.md) owns rendering and batch lifecycle semantics.

`WorkflowConfigurationView` exposes safe editable templates, endpoint and optimistic settings revision through `ctx.videoWorkflows`. Saving keeps workflow targets disabled; explicit activation registers them without starting an engine. The [workflow provider](../../packages/video/video-comfyui/README.md) owns validation, transport credentials and runtime bindings.

Providers register through `registerGenerator` and return durable video references. The pi-ai provider resolves current profiles, credentials, endpoint, headers, and time limits for each attempt. Reference images use the provider's supported reference-image request, distinct from a first-frame image. Unsupported combinations fail before submission.

`generationTargets` exposes current provider-owned generator/model pairs and their declared input limits. Listing targets does not submit work or expose credentials. Generation requires exactly one matching target and checks declared restrictions before recording an attempt. The optional [ComfyUI provider](../../packages/video/video-comfyui/README.md) uses operator-configured API workflows and contributes targets through this same registry; it is disabled in the shipped Web composition until configured.

Export normalizes selected clips to configured dimensions and frame rate, preserves audio, supplies silence where needed, and concatenates one MP4. It requires host-local FFmpeg and FFprobe executables and uses managed subprocesses. Temporary files are removed after the processes exit. Tools expose production operations rather than arbitrary FFmpeg arguments.

## Persistence and media access

The storage-domain provider persists project edits and results independently of Client memory. Model tools return the project as their logged result; user edits become model-visible through those recorded reads.

Project media reads authorize attachment membership and return bounded encoded slices. The Session `videoAttachment` operation separately authorizes existing `generate_video` results against successful calls in that Session's log. Both operations accept attachment identities rather than filesystem paths or provider URLs.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxvideoproduction--videoproduction"></a>

### `ctx.videoProduction` — `VideoProduction`

One project per existing Session, persisted through the configured storage-domain backend.

```ts cordis-catalog
/**
 * Register one named generation provider without copying provider credentials.
 * @param name - unique configured generation route name.
 * @param generator - cancellation-aware provider returning a durable attachment.
 * @param describe - current selectable configurations; omission exposes one unrestricted named route.
 * @returns disposer removing only this registration.
 */
registerGenerator(name: string, generator: VideoGenerator, describe: DescribeVideoGenerator = () => [{ title: name }]): () => void

/**
 * List current provider-owned configurations without starting generation or contacting a model.
 * @returns selectable generator/model pairs and declared limits, without credentials.
 */
@Remote('generationTargets') generationTargets(): VideoGenerationTarget[]

/** Start missing-shot work owned by the Host, independent of the calling page.
 * @param sessionId - existing project Session.
 * @param input - observed project revision and generation route.
 * @returns durably admitted batch without waiting for generation.
 */
@Remote('startBatch') startBatch(sessionId: SessionId, input: VideoBatchInput): Promise<VideoBatch>

/** Read the latest batch for this Session lifecycle.
 * @param sessionId - existing project Session.
 * @returns durable descriptor, or null when absent.
 */
@Remote('batch') batch(sessionId: SessionId): Promise<VideoBatch | null>

/** Read production batches for a bounded set of existing Sessions.
 * @param sessionIds - at most 256 Session identities.
 * @returns current lifecycle descriptors, omitting Sessions without batches.
 */
@Remote('listBatches') async listBatches(sessionIds: readonly SessionId[]): Promise<readonly VideoBatch[]>

/** Request pause after the current shot finishes.
 * @param sessionId - owning Session.
 * @param id - observed batch identity.
 * @returns pausing while provider work remains, otherwise paused.
 */
@Remote('pauseBatch') pauseBatch(sessionId: SessionId, id: VideoBatchId): Promise<VideoBatch>

/** Request cancellation after the current shot finishes; saved results remain available.
 * @param sessionId - owning Session.
 * @param id - observed batch identity.
 * @returns cancelling while provider work remains, otherwise cancelled.
 */
@Remote('cancelBatch') cancelBatch(sessionId: SessionId, id: VideoBatchId): Promise<VideoBatch>

/** Resume unattempted shots without replaying unconfirmed submissions.
 * @param sessionId - owning Session.
 * @param id - observed batch identity.
 * @returns admitted descriptor after frozen inputs and saved results are checked.
 */
@Remote('resumeBatch') resumeBatch(sessionId: SessionId, id: VideoBatchId): Promise<VideoBatch>

/**
 * Read bounded saved-project summaries for existing Session identities without creating or resuming an Agent.
 * @param sessionIds - at most 256 distinct Session identities, each at most 256 characters.
 * @param signal - caller cancellation during lifecycle inspection.
 * @returns only currently matching saved projects; display titles contain at most 160 Unicode code points.
 * Deleted Sessions and rows from an earlier lifecycle are omitted; unrelated persistence failures reject.
 */
@Remote('projectSummaries') async projectSummaries(sessionIds: readonly SessionId[], signal: AbortSignal): Promise<readonly VideoProjectSummary[]>

/**
 * Read this Session's project without creating or resuming an Agent.
 * @param sessionId - existing Session selecting the project.
 * @returns the current project, or an unpersisted revision-zero project.
 */
@Remote('view') async view(sessionId: SessionId): Promise<VideoProject>

/**
 * Replace editable fields while preserving attempts for retained shot identities.
 * @param sessionId - existing Session selecting the project.
 * @param input - observed revision and complete editable project fields.
 * @returns the committed project; stale revisions and foreign image references reject.
 */
@Remote('update') async update(sessionId: SessionId, input: VideoProjectInput): Promise<VideoProject>

/**
 * Admit a user-uploaded reference and append its asset after durable storage succeeds.
 * @param sessionId - existing Session selecting the project.
 * @param input - observed revision, asset description, and encoded raster image.
 * @param signal - cancellation before image admission and project commit.
 * @returns the committed project containing the newly owned image.
 */
@Remote('addAsset') async addAsset(sessionId: SessionId, input: VideoAssetUpload, signal: AbortSignal): Promise<VideoProject>

/**
 * Reorder every current shot exactly once without changing its generation versions.
 * @param sessionId - existing Session selecting the project.
 * @param shotIds - complete permutation of current shot identities.
 * @returns the committed film order.
 */
@Remote('reorder') reorder(sessionId: SessionId, shotIds: readonly VideoShotId[]): Promise<VideoProject>

/**
 * Generate a new version from this shot's current prompt and selected reference assets.
 * @param sessionId - existing Session selecting the project.
 * @param shotId - current shot whose versions receive the attempt.
 * @param selection - optional generator, video model, and atomic missing-shot condition.
 * @param signal - caller cancellation; provider work also observes the configured deadline.
 * @returns the unchanged project when onlyIfMissing finds a completed video;
 * otherwise the committed project with a completed, failed, or interrupted attempt.
 */
@Remote('generate') async generate( sessionId: SessionId, shotId: VideoShotId, selection: VideoGenerationSelection, signal: AbortSignal, ): Promise<VideoProject>

/**
 * Normalize and concatenate the currently selected completed versions in shot order.
 * @param sessionId - existing Session selecting the project.
 * @param signal - caller cancellation; FFmpeg also observes the configured deadline.
 * @returns the project retaining this successful or failed export attempt.
 */
@Remote('export') export(sessionId: SessionId, signal: AbortSignal): Promise<VideoProject>

/**
 * Read a bounded media slice only after this exact project proves attachment ownership.
 * @param sessionId - existing Session selecting the project.
 * @param projectId - exact project identity from its latest view.
 * @param attachmentId - image or completed-video identity owned by that project.
 * @param offset - zero-based encoded byte position.
 * @param length - requested bytes, at most the fixed 256 KiB transport safety limit.
 * @returns canonical metadata, base64 slice, and byte offsets.
 */
@Remote('readMedia') async readMedia( sessionId: SessionId, projectId: VideoProjectId, attachmentId: AttachmentId, offset: number, length: number, ): Promise<VideoMediaChunk>

/**
 * Freeze a portable project snapshot and its referenced media in a bounded download.
 * @param sessionId - existing source Session owning the saved project.
 * @param signal - cancellation during attachment reads and package preparation.
 * @returns ephemeral download ticket; the package contains no source Session identity or executable host configuration.
 */
@Remote('prepareProjectExport') prepareProjectExport(sessionId: SessionId, signal: AbortSignal): Promise<VideoProjectTransfer>

/**
 * Read a prepared portable package without exposing its host path.
 * @param sessionId - Session owning the transfer.
 * @param transferId - live download identity from preparation.
 * @param offset - zero-based encoded file position.
 * @param length - requested raw bytes, from 1 through 262,144.
 * @param signal - caller cancellation.
 * @returns base64 slice and exact raw-byte offsets.
 */
@Remote('readProjectTransfer') readProjectTransfer( sessionId: SessionId, transferId: VideoProjectTransferId, offset: number, length: number, signal: AbortSignal, ): Promise<VideoProjectTransferChunk>

/**
 * Reserve a bounded upload for restoring into an existing Session with no saved project.
 * @param sessionId - target Session; existing projects are never overwritten.
 * @param bytes - exact total raw package size.
 * @param signal - caller cancellation before reservation.
 * @returns ephemeral upload ticket and its next required byte offset.
 */
@Remote('beginProjectImport') beginProjectImport(sessionId: SessionId, bytes: number, signal: AbortSignal): Promise<VideoProjectTransfer>

/**
 * Append one canonical base64 slice to an owned project upload.
 * @param sessionId - target Session owning the upload.
 * @param transferId - live upload identity.
 * @param offset - exact next raw byte offset, preventing gaps and duplicate writes.
 * @param data - at most 262,144 decoded bytes as canonical base64.
 * @param signal - caller cancellation during the write.
 * @returns upload ticket with the committed next offset.
 */
@Remote('writeProjectTransfer') writeProjectTransfer( sessionId: SessionId, transferId: VideoProjectTransferId, offset: number, data: string, signal: AbortSignal, ): Promise<VideoProjectTransfer>

/**
 * Verify the complete package and all media before atomically restoring its project.
 * @param sessionId - target Session, still required to have no saved project.
 * @param transferId - complete live upload identity.
 * @param signal - cancellation through verification, attachment admission, and project commit.
 * @returns restored project and declarative model/workflow requirements; no generator is installed or started.
 */
@Remote('commitProjectImport') commitProjectImport(sessionId: SessionId, transferId: VideoProjectTransferId, signal: AbortSignal): Promise<VideoProjectImportResult>

/**
 * Release one owned package upload or download and its private files.
 * @param sessionId - Session owning the transfer.
 * @param transferId - live transfer identity.
 * @returns completion after temporary files are removed; an absent or already-consumed ticket is a no-op.
 */
@Remote('cancelProjectTransfer') cancelProjectTransfer(sessionId: SessionId, transferId: VideoProjectTransferId): Promise<void>
```

Types: [AttachmentId](attachment.md) · [SessionId](core.md)

Source: [`packages/video/video-production/src/index.ts`](../../packages/video/video-production/src/index.ts)

<a id="ctxvideoworkflows--videoworkflows"></a>

### `ctx.videoWorkflows` — `VideoWorkflows`

Workflow editor; saving and enabling never contact or start the engine.

```ts cordis-catalog
/**
 * Read a portable configuration and its optimistic write revision.
 * @returns Safe editable data; unsafe host templates fail without returning their values.
 */
@Remote view(): Promise<WorkflowConfigurationView>

/**
 * Validate editable fields against this host's transport limits without persistence.
 * @param configuration - Endpoint and API workflows to validate.
 * @returns Successful validation; invalid data raises a value-free diagnostic.
 */
@Remote validate(configuration: WorkflowConfiguration): Promise<{ valid: true }>

/**
 * Persist safe workflow edits disabled, retaining host headers and runtime binding.
 * @param configuration - Complete editable workflow fields; omitted URL retains the host URL.
 * @param expectedRevision - Revision read by the editor; stale writes are refused.
 * @returns Committed safe configuration and revision.
 */
@Remote async save(configuration: WorkflowConfiguration, expectedRevision: number): Promise<WorkflowConfigurationView>

/**
 * Register or unregister saved workflow targets without starting the engine.
 * @param enabled - Desired workflow availability; disabling cancels active attempts.
 * @param expectedRevision - Revision read by the editor; stale writes are refused.
 * @returns Committed safe configuration and revision.
 */
@Remote async setEnabled(enabled: boolean, expectedRevision: number): Promise<WorkflowConfigurationView>
```

Source: [`packages/video/video-comfyui/src/workflows.ts`](../../packages/video/video-comfyui/src/workflows.ts)
<!-- END GENERATED cordis-surface -->
