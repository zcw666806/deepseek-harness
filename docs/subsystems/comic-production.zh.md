# 漫画制作

[English](comic-production.md) | 中文

[漫画制作服务](../../packages/comic/comic-production/README.zh.md)按工作区保存稿件。工作区中的会话可以打开或编辑稿件。[浏览器工作台](../../packages/client/ui-comic-production/README.zh.md)切换会话后可以读取同一份已提交项目。

## 稿件数据

[ComicProject](../../packages/comic/comic-production/src/types.ts)保存独立标识、工作区标识、修订号和有序页面。页面以页像素保存画格几何。画格保存原画图层和对白气泡。气泡有独立文字、说话人和以格像素计的几何。图层记录所有留存的 PNG 版本及已采用图像。

## 原始图像与项目转移

服务以 SHA-256 标识保存原始 PNG 字节，文件写入完成后发布项目引用。编辑时校验几何与原画引用，提交时检查预期修订号。媒体读取先核对项目和图像引用，再返回有界分片。

带版本的项目包包含可编辑稿件和原始 PNG。导入会校验引用，并在会话所属工作区创建独立项目。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcomicproduction--comicproduction"></a>

### `ctx.comicProduction` — `ComicProduction`

Commit manuscript changes and transfer only PNGs referenced by an authorized project.

```ts cordis-catalog
/**
 * List manuscripts in the Workspace that owns the Session.
 * @param sessionId - attached Session opening the workbench.
 * @param signal - cancellation before reading the project list.
 * @returns the Workspace's project titles and revisions.
 */
@Remote('list') list(sessionId: SessionId, signal?: AbortSignal): ComicProjectSummary[]

/**
 * Create a manuscript with three editable pages in the Session's Workspace.
 * @param sessionId - attached Session selecting the owner Workspace.
 * @param title - user-supplied manuscript title.
 * @param signal - cancellation before creating the project.
 * @returns the committed initial project.
 */
@Remote('create') create(sessionId: SessionId, title: string, signal?: AbortSignal): Promise<ComicProject>

/**
 * List configured image generation targets whose Host credentials currently resolve.
 * @param signal - optional cancellation before returning the list.
 * @returns selector entries without provider endpoints or credential references.
 */
@Remote('storyboardGenerationTargets') async storyboardGenerationTargets(signal?: AbortSignal): Promise<ComicImageGenerationTarget[]>

/**
 * Read the Session's image target, even if a configured choice has since become unavailable.
 * @param sessionId - attached Session selecting the owner Workspace.
 * @param signal - optional cancellation while inspecting the Session.
 * @returns the stored target, the sole configured target, or undefined when the Session has no target.
 */
@Remote('storyboardGenerationTarget') async storyboardGenerationTarget(sessionId: SessionId, signal?: AbortSignal): Promise<ComicImageGenerationTargetId | undefined>

/**
 * Durably choose the image route used for future generations in this Session.
 * @param sessionId - attached Session selecting the owner Workspace.
 * @param targetId - configured image target with a usable credential.
 * @param signal - optional cancellation before the selection is submitted for storage.
 * @returns completion after the selected route is durable.
 */
@Remote('selectStoryboardGenerationTarget') selectStoryboardGenerationTarget(sessionId: SessionId, targetId: ComicImageGenerationTargetId, signal?: AbortSignal): Promise<void>

/**
 * Check whether the Session can generate artwork with its selected image route.
 * @param sessionId - Attached Session selecting the owner Workspace.
 * @param signal - Cancellation before returning availability.
 * @returns Whether the image route and its Host credential are available.
 */
@Remote('storyboardGenerationAvailable') async storyboardGenerationAvailable(sessionId: SessionId, signal?: AbortSignal): Promise<boolean>

/**
 * Read the result saved for a storyboard or join its current generation.
 * @param sessionId - Attached Session selecting the owner Workspace.
 * @param messageId - Original Assistant message identity in the Session.
 * @param signal - Cancellation before delivering the project.
 * @returns The saved project, or undefined before generation starts.
 */
@Remote('storyboardResult') async storyboardResult(sessionId: SessionId, messageId: string, signal?: AbortSignal): Promise<ComicProject | undefined>

/**
 * Draw the four panels together and publish one editable project for this source message.
 * @param sessionId - Attached Session selecting the destination Workspace.
 * @param messageId - Original Assistant message identity in the Session.
 * @param draft - Four ordered panels and their editable dialogue.
 * @param artDirection - Visual style and recurring details from the storyboard.
 * @param signal - Cancellation before accepting the request. Accepted work remains on the Host when a viewer leaves.
 * @returns The saved project, including artwork for each panel. Repeated requests share active work or return the saved project.
 */
@Remote('generateStoryboard') async generateStoryboard( sessionId: SessionId, messageId: string, draft: ComicDraft, artDirection: string, signal?: AbortSignal, ): Promise<ComicProject>

/**
 * Open the current revision of a project in the Session's Workspace.
 * @param sessionId - attached Session selecting the owner Workspace.
 * @param projectId - stable project identity from the picker.
 * @param signal - cancellation before reading the project.
 * @returns the committed project, including retained artwork references.
 */
@Remote('open') open(sessionId: SessionId, projectId: ComicProjectId, signal?: AbortSignal): ComicProject

/**
 * Save complete editable geometry, dialogue, and adopted versions in one revision.
 * @param sessionId - attached Session selecting the owner Workspace.
 * @param projectId - project to edit.
 * @param revision - expected committed project revision.
 * @param draft - editable values; retained artwork references must match the current project.
 * @param signal - cancellation before the revision starts committing.
 * @returns the new committed project.
 */
@Remote('save') save(sessionId: SessionId, projectId: ComicProjectId, revision: number, draft: ComicDraft, signal?: AbortSignal): Promise<ComicProject>

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
@Remote('saveLayerImage') saveLayerImage( sessionId: SessionId, projectId: ComicProjectId, revision: number, panelId: ComicPanelId, layerId: ComicLayerId, pngBase64: string, signal?: AbortSignal, ): Promise<ComicProject>

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
@Remote('readImage') readImage( sessionId: SessionId, projectId: ComicProjectId, imageId: ComicImageId, offset: number, length: number, signal?: AbortSignal, ): Promise<ComicImageChunk>

/**
 * Freeze a portable project package with all retained original images.
 * @param sessionId - attached Session selecting the owner Workspace.
 * @param projectId - project to package.
 * @param signal - cancellation before delivering the package.
 * @returns editable manuscript data and verified original PNGs.
 */
@Remote('exportProject') exportProject(sessionId: SessionId, projectId: ComicProjectId, signal?: AbortSignal): Promise<ComicProjectPackage>

/**
 * Validate and import a portable project into the current Workspace as a new project.
 * @param sessionId - attached Session selecting the destination Workspace.
 * @param data - portable draft and its complete original-image set.
 * @param signal - cancellation before the project starts committing.
 * @returns the independently editable imported project.
 */
@Remote('importProject') importProject(sessionId: SessionId, data: ComicProjectPackage, signal?: AbortSignal): Promise<ComicProject>
```

Types: [SessionId](core.zh.md)

Source: [`packages/comic/comic-production/src/index.ts`](../../packages/comic/comic-production/src/index.ts)
<!-- END GENERATED cordis-surface -->
