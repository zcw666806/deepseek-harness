# 视频制作

[English](video-production.md) | 中文

[video-production 包](../../packages/video/video-production/README.zh.md)为每个 Session 拥有一个持久项目。其服务定义、本地项目提供方、模型工具和 Remote 消费方共同演进，因此位于同一包中。[浏览器工作台](../../packages/client/ui-video-production/README.zh.md)消费同一组项目操作。

## 项目数据

[VideoProject](../../packages/video/video-production/src/types.ts)包含品牌化标识、Session 标识、乐观修订号、标题、可复用素材、顺序镜头与整片导出。`VideoAsset` 标识角色、场景或道具，可以引用已准入的图片。`VideoShotInput` 包含可编辑提示词、请求时长、画面比例、分辨率、素材引用与选中的输出版本。数组顺序定义成片顺序；仅移动画布卡片不会改变该顺序。

`VideoVersion` 保留每次尝试的提示词、状态、生成器标识与名称、可用的生成器配置修订、模型、附件与失败诊断。缺少生成器元数据的历史尝试保留为来源未知。重试失败时保留已完成版本。`VideoExport` 记录成片所用的确切源版本。Host 重启后恢复的运行中尝试标记为中断；恢复不会静默重新提交付费生成。

## 生成与导出

`VideoClipEdit` 记录相对于源视频的裁切、原声音量，以及相对于裁切后镜头的 `VideoCaption` 时间。导出在源版本标识旁捕获对齐的编辑值。`VideoBatch` 属于 Session 生命周期，并在独立存储域中保留冻结的生成输入和逐镜头检查点。恢复会将未确认提交交由核对；明确继续时仅提交尚未提交的镜头。[包参考](../../packages/video/video-production/README.zh.md)拥有渲染和批次生命周期语义。

`WorkflowConfigurationView` 通过 `ctx.videoWorkflows` 提供安全的可编辑模板、端点及乐观设置修订号。保存会禁用工作流目标；明确启用会注册目标，不启动引擎。[工作流提供方](../../packages/video/video-comfyui/README.zh.md)拥有校验、传输凭据和运行环境绑定。

提供方通过 `registerGenerator` 注册并返回持久视频引用。pi-ai 提供方为每次尝试解析当前 profile、凭据、端点、请求头和时间限制。参考图片通过提供方支持的参考图请求传递，与首帧图片语义不同。不支持的组合在提交前失败。

`generationTargets` 公开提供方当前声明的生成器与模型组合及输入限制。列出目标不会提交任务或公开凭据。生成要求恰好匹配一个目标，并在记录尝试前检查声明的限制。可选的 [ComfyUI 提供方](../../packages/video/video-comfyui/README.zh.md)使用运维配置的 API 工作流，通过同一注册表贡献目标；随附 Web 组合在完成配置前禁用它。

导出将选中镜头统一到配置的尺寸和帧率，保留音频、按需补充静音轨，再合成为一个 MP4。导出要求宿主本地的 FFmpeg 和 FFprobe 可执行文件，并使用受管理子进程。临时文件在进程退出后删除。工具暴露制作操作，不接受任意 FFmpeg 参数。

## 持久化与媒体访问

存储领域提供方独立于 Client 内存持久保存项目编辑和结果。模型工具将项目作为记录在日志中的结果返回；用户编辑通过这些已记录读取进入模型上下文。

项目媒体读取核对附件归属，并返回有上限的编码分块。Session `videoAttachment` 操作独立地根据同一 Session 日志中的成功调用授权已有 `generate_video` 结果。两个操作都接收附件标识，不接收文件系统路径或提供方 URL。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [AttachmentId](attachment.zh.md) · [SessionId](core.zh.md)

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
