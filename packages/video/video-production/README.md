---
description: "Session-owned video projects, reusable image references, shot generation versions, and local film export for users and maintainers composing a production workflow."
kind: "package-reference"
---

# @deepseek-ai/dsh-video-production

English | [中文](README.zh.md)

## Summary

`dsh-video-production` owns one durable video project per existing Session. A project contains reusable character, scene, and prop images, ordered storyboard shots, generation attempts, selected video versions, and film exports. The Web production view and the `video_project` tool use this same state. Generation providers supply durable video attachments; this package owns project editing, attempt history, media authorization, and host-local FFmpeg export.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts this service beside the existing attachment, storage-domain, Session persistence, and tool services. A custom composition mounts those same capabilities and a video generator. Project reads never create or resume an Agent. A revision-zero view represents an existing Session with no saved project; the first update persists its title, assets, and shots.

`projectSummaries` provides a read-only presentation index for up to 256 distinct Session identities per request. It returns only saved projects matching the current Session lifecycle, with project identity, revision, and a display title limited to 160 Unicode code points. The complete title and project remain available through `view`. Missing or deleted Sessions and stale lifecycle rows are omitted; unrelated persistence failures reject. Queries neither create nor materialize Sessions and never invoke a model. A sidebar can use this index to retain project-only Sessions without changing the meaning of an empty conversation or moving project ownership into Session data.

### Editing and generation

`update` replaces editable project fields using the revision returned by `view`. Stable shot identities retain their complete attempt history. A shot selects a completed version by its identity; `reorder` accepts a complete permutation of current shot identities. A reference image must belong to this project or already appear as an admitted image in this Session. `addAsset` admits an uploaded raster image and appends its asset after storage succeeds.

`generate` appends one attempt and waits for the selected provider. Each shot passes its asset images in `assetIds` order; selecting an asset without an image fails before provider invocation. Attempts retain their original prompt, duration, aspect ratio, resolution, and ordered reference images after later project edits. A successful attempt becomes the selected version. Failures and cancellations retain their attempt record, and retrying creates another version. Per-Session mutation queues prevent overlapping operations from replacing each other's results. UI batches use `onlyIfMissing` to recheck the current shot inside that queue and skip generation when a completed video version already exists, including when another caller finishes while this request waits. Ordinary generation and retry still create new versions. Reads can observe an attempt while it is running.

`generationTargets` lists current provider-owned generator/model pairs, titles, configuration revisions, and declared input limits without contacting a model. Generation requires exactly one matching current target and rejects unsupported settings before creating an attempt. Each new attempt freezes the selected generator identity, title, and available configuration revision beside its inputs. Historical attempts without these fields retain unknown provenance.

### Host-owned production batches

`startBatch` saves a missing-shot batch before starting generation; closing the browser page does not stop it. `batch` and `listBatches` read its durable progress. Each Session retains one current batch. `pauseBatch` and `cancelBatch` stop at the next shot boundary: `pausing` and `cancelling` mean the current provider request can still finish and incur charges. Completed videos remain in the project. Controls require the observed batch identity, and a Session's replacement lifecycle cannot inherit its batch.

After a Host restart, no batch submits work automatically. `resumeBatch` continues only unattempted shots after checking the frozen generation inputs, ordered references, provider configuration revision, and retained completed results. Changed inputs or missing completed results require review. A checkpoint without a recorded outcome becomes `uncertain`, including a crash between reserving a submission and contacting the provider. Resume never retries uncertain shots; check their provider outcome before explicitly requesting another individual generation. Batch descriptors are project data, not serializable `ctx.jobs` callbacks, and they are not included in portable project packages.

### Export and media

An adopted shot can retain optional non-destructive `edit` values: source-relative `trimStartSeconds` and `trimEndSeconds`, original-audio `volume` from 0 through 4, and timed literal captions. Caption times are relative to the trimmed clip; 0 mutes original audio and 1 preserves its volume. Saving edits leaves source attachments and generation history unchanged. Each export captures aligned `clipEdits` alongside its source-version identities. The renderer trims picture and audio together and reads caption text from private UTF-8 files with expression expansion disabled. `maxCaptionsPerShot` bounds caption records; optional `subtitleFontPath` selects a host-local font copied into the private render directory.

`export` concatenates the selected completed version of every shot in project order. FFmpeg and ffprobe must already be installed in the host execution world; `ffmpegPath` and `ffprobePath` select their executables. The renderer normalizes clips to the configured dimensions and frame rate, retains existing audio, pads short audio tracks, and supplies silence for clips without audio. Exported MP4 files become durable attachments. Missing executables or an incompatible execution world produce a retained failed export with an actionable diagnostic; the service installs nothing.

`readMedia` requires the Session identity, project identity, and an attachment currently referenced by that project. It returns canonical metadata and a base64 slice addressed by raw-byte offsets. Each request is limited to 256 KiB; `nextOffset` and `totalBytes` allow clients to assemble a browser preview or download without receiving a host path or provider credential.

### Portable project packages

`prepareProjectExport` freezes the current project and its referenced image/video bytes into a `project.dshvideo` download. The versioned binary container stores a bounded JSON manifest followed by raw media frames; shared attachment identities occur once. It preserves assets, shot order, frozen generation inputs, accepted versions, historical films, and recorded generator/workflow requirements. Source Session identity, project identity, revision, execution diagnostics, executable paths, credentials, and Session transcripts are excluded. User-authored prompts and descriptions remain project content. When the optional capability manager is mounted, its explicit portable configuration manifest accompanies the project; model weights and runtime environments do not.

Downloads and uploads use Session-owned transfer identities and raw-byte offsets. `readProjectTransfer` reads at most 256 KiB; `writeProjectTransfer` accepts canonical base64 encoding at the exact next offset. Uploads declare their complete size before writing. `commitProjectImport` requires every byte, validates the format, strict record schemas, relationships, frame lengths, and SHA-256 hashes, admits media through the target attachment store, and commits the complete project once. The target must be an existing Session without a saved project, including when it changes after upload begins. Its identity and lifecycle replace the source identity. Running attempts become interrupted, selected completed versions remain selected, and historical film source identities may outlive deleted shots.

The import result returns declarative generation requirements and any portable capability configuration for explicit restoration through the capability manager. Import does not install dependencies, start engines, invoke models, or restore machine-specific secrets. Failed admission can leave unreferenced attachment blobs but never a partially restored project. Concurrent writes, reads, commits, and cancellation are serialized by the transfer owner. `cancelProjectTransfer` removes private files and is a no-op for consumed or absent transfers; a live transfer owned by another Session rejects.

Package defaults allow 768 MiB per complete container, a 4 MiB manifest, four retained transfers, and a 30-minute transfer lifetime. The corresponding configuration fields are `maxProjectPackageBytes`, `maxProjectPackageManifestBytes`, `maxProjectTransfers`, and `projectTransferTimeoutMs`. Complete-package checks include the manifest and media, and no operation exposes a temporary host path. Transfer files expire, disappear on service unload, and do not resume after restart; the downloaded package is the portable recovery artifact. Media framing and hashing use bounded buffers, while attachment admission may hold one complete image or clip in memory under the configured package limit.

### Configuration

The generated [configuration catalog](../../../docs/config-catalog.md) describes all fields. Project defaults allow 64 shots, 64 assets, 20 attempts per shot, 20 exports, and 1 MiB of serialized project data. Generation and export each have a five-minute deadline. Film output defaults to 1280×720 at 24 frames per second, with a 512 MiB source/output size limit. Deployment changes are explicit plugin configuration.

```yaml
- id: video-production
  name: '@deepseek-ai/dsh-video-production'
  config:
    ffmpegPath: ffmpeg
    ffprobePath: ffprobe
    generationTimeoutMs: 300000
    exportTimeoutMs: 300000
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `video_production` storage domain holds one revisioned project per Session and binds it to that Session's creation time. Writes wait for Session materialization before committing the sidecar. A reused Session identity cannot inherit another lifecycle's project, and a long operation cannot commit into a replacement Session. On service startup, attempts left running by a terminated process become interrupted. Unloading stops mutation admission, cancels active work, awaits each operation, and closes the domain.

`registerGenerator` contributes a named cancellation-aware provider and returns its disposer. Its optional description callback supplies the current selectable configurations; omission exposes one named route without declared restrictions. Providers receive the resolved prompt, duration, aspect ratio, resolution, selected reference images, and optional model identity. They return a durable attachment rather than a provider download URL. The service verifies stored bytes before recording success. Model tools log the complete returned project as ordinary tool output; direct UI edits become model-visible only when a subsequent tool reads the project.

The service reserves enough project space to retain a bounded failure before starting paid generation or export. Oversized terminal metadata or diagnostics become a failed attempt rather than leaving the project running. Storage I/O errors remain infrastructure errors. FFmpeg processes use the managed subprocess service, fixed argument arrays, scrubbed environments with `FFREPORT` removed, private temporary files, and awaited process-tree teardown. Input demuxers are fixed to MP4 or WebM and protocols to local files and pipes. A video `fps` filter establishes the configured cadence; normalized video starts at timestamp zero and is encoded once. Its measured duration bounds audio trimming or padding in a separate mux operation that copies the encoded video.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Video production subsystem](../../../docs/subsystems/video-production.md) — domain ownership and composition.
- [Video production UI](../../client/ui-video-production/README.md) — storyboard viewing and editing.
- [pi-ai adapter](../../llm/llm-pi-ai/README.md) — native video provider configuration.
- [Attachments](../../attachment/attachment/README.md) — durable image and video storage.

-----

<a id="model-experience"></a>
## Model Experience

### Project tool

#### What the model sees

The [`video_project` tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-video-production) owns the action and parameter descriptions. Every successful action returns the complete current project as JSON, including reference metadata, shot prompts, ordered attempts, selected attachments, and export outcomes. Video and image bytes are absent from this result.

#### Token effect

The tool schema contributes a fixed request prefix when this plugin is mounted. Each call appends its complete project result; `maxProjectBytes` bounds each individual result, while retained history can contain multiple project versions.

#### KV Cache effect

The schema is stable for the plugin lifetime and project results append to history. Editing a project does not rewrite earlier model messages; a subsequent tool result introduces the updated state. The calling model's provider owns cache availability and eviction.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One project belongs to one Session** — package restoration creates a project in a new empty target Session; live sharing and project inheritance when forking a Session are not provided.
- **Individual generation and export calls wait for completion** — production batches survive page closure and preserve restart checkpoints, but uncertain submissions never retry automatically and individual calls do not resume after restart.
- **Export requires host-local FFmpeg and ffprobe** — remote execution worlds without access to host temporary files are rejected; no executable is bundled or installed.
- **Film editing is per adopted clip** — cuts, original audio volume and timed literal captions are supported; transitions, voice synthesis, music mixing and automatic dialogue alignment require separate operations.
- **Reference consistency depends on the configured provider** — this package organizes references and preserves their order but does not generate reference images or guarantee character identity.
- **Video inputs and native editing are separate operations** — uploading video for model input, provider-native video edits, and video extension are not exposed by this project workflow.

<a id="dev-note"></a>
### Dev Note

None.
