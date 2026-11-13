# Comic production

English | [中文](comic-production.zh.md)

The [comic production service](../../packages/comic/comic-production/README.md) owns manuscripts by Workspace. A Session in that Workspace can open or edit a manuscript. The [browser workbench](../../packages/client/ui-comic-production/README.md) reads the same committed project after switching conversations.

## Manuscript data

[ComicProject](../../packages/comic/comic-production/src/types.ts) holds a stable identity, Workspace identity, revision, and ordered pages. Pages hold panel geometry in page pixels. Panels hold artwork layers and dialogue balloons. Balloons have independent text, speakers, and geometry in panel pixels. A layer records every retained PNG version and the adopted image.

## Original media and project transfer

The service stores original PNG bytes under their SHA-256 identities and publishes project references after the files have been written. Project edits validate geometry and artwork references and check the expected revision at commit. Media reads authorize the project and image reference before returning bounded slices.

The versioned project package contains the editable manuscript and original PNGs. Import verifies the references and creates an independent project in the Session's Workspace.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [SessionId](core.md)

Source: [`packages/comic/comic-production/src/index.ts`](../../packages/comic/comic-production/src/index.ts)
<!-- END GENERATED cordis-surface -->
