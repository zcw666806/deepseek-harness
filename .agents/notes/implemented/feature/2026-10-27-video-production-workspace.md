# Agent Note: Session-owned video production projects

Status: implemented

English | [中文](2026-10-27-video-production-workspace.zh.md)

## Problem

A generated video attachment does not preserve a production plan. Authors need reusable character and scene references, editable shots, generation history, an explicit film order, and a way to preview and export selected results. A failed retry must not replace an accepted clip or silently submit another paid request after restart.

## Decision

The [video-production service](../../../../packages/video/video-production/README.md) owns one revisioned project per Session through the existing storage-domain provider. It binds the record to the Session's creation time, serializes mutations, retains generation and export attempts, and marks abandoned running attempts interrupted on recovery. Model tools return complete projects as logged output; browser edits become model-visible through those recorded reads. The [workspace UI](../../../../packages/client/ui-video-production/README.md) consumes the same operations. Canvas position and film order are separate values.

The browser uses a pinned [React Flow](https://reactflow.dev/learn) renderer for references, prompts, generators, recorded videos, film assembly, and rendered films. Nodes and connections derive from production records. Editable reference edges change `assetIds`; adopted-video edges change `selectedVersionId`. Shot ownership edges remain fixed. Coordinates, viewport, and selection belong to the browser view store; no second execution graph or job engine is persisted. Historical videos retain their frozen inputs, and a historical film retains its recorded source-version identities when the current plan changes.

The [durable batch decision](2026-11-03-production-workflow-controls-and-durable-batches.md) owns persisted Host execution and recovery. Batch generation captures saved inputs and dispatches individual operations serially. The provider service checks `onlyIfMissing` inside the Session mutation queue, before creating an attempt or calling a generator. Concurrent batches therefore skip a shot completed by the earlier queued request. Explicit single-shot retries still generate another version. Failure and cancellation stop unstarted batch work without discarding completed versions.

Generation targets are provider-owned descriptions of current generator/model pairs and declared limits. A request resolves exactly one current target before recording an attempt. New versions freeze generator identity, title, and configuration revision when supplied. Historical versions may omit the generator identity, title, and configuration revision. A browser selection applies to the next single or batch operation and is not stored as a shot setting. Removing the selected target requires an explicit replacement selection.

The pi-ai adapter registers an effect-owned generation provider. Requests preserve the shot's reference-image order and use native reference-image parameters only for supported models. Providers return durable attachments, observe cancellation, and reach quiescence during unload. The [generation-routing decision](../bug-fix/2026-10-19-video-generation-routing.md) remains active: video targets are not conversational models.

The optional [ComfyUI adapter](../../../../packages/video/video-comfyui/README.md) registers operator-configured API-format workflows through the same provider registry. It is dormant by default. Immutable template revisions and explicit scalar bindings determine supported durations, dimensions, ordered references, and the selected output node. Each attempt owns a UUID, private upload/output directory, and one submission without retries. Server output directories use platform-specific separators; the adapter normalizes separators before checking relative components and operation-directory ownership. Cancellation uses the server's job-scoped atomic endpoint and an independent cleanup budget; an uncertain remote termination is reported with its job identity. A local abort is not evidence that remote execution stopped. The adapter neither installs ComfyUI nor downloads models or custom nodes.

Media reads authorize project membership or a successful generation recorded in the addressed Session. Bounded encoded slices avoid a whole-video RPC frame. Film export accepts selected immutable clip references and uses managed FFmpeg/FFprobe subprocesses with fixed arguments, private temporary files, normalized video, preserved audio, and silence where needed. A video `fps` filter establishes frame cadence before encoding. The measured duration of that encoded video explicitly bounds a separate audio mux operation; encoder buffering and `-shortest` alone can extend audio beyond short clips and introduce gaps between them. Video is encoded once and copied during audio muxing. Source timestamps reset to zero, source demuxers are fixed, protocols allow only local files and pipes, and renderer environments remove `FFREPORT`. The service does not expose arbitrary renderer commands or install executables.

[Toonflow's pinned video-node and canvas implementation](https://github.com/HBAI-Ltd/Toonflow-app/tree/af6e884c3d8cda353acaf8ef13aea8ea754a4afd) supplies design evidence for reusable references, explicit media versions, and a shared production canvas. Its application, plugins, runtime, and dependencies are not imported. The [Qywork adoption decision](2026-10-19-qywork-capability-adoption.md) retains its independently useful resource, workflow, and filesystem decisions.

## Alternatives considered

**Import a complete external creation application.** Its runtime, storage, credentials, and task ownership would compete with existing Harness services. The project adopts observed behavior through its own extensions.

**Use a browser-only board as production state.** Reload, model tools, and film export would disagree about selected versions and shot order. The persistent service owns those facts; the UI owns its current selection and zoom.

**Build another node-editor framework or import a graph execution engine.** Port interaction, viewport navigation, selection, and node measurement are maintained renderer capabilities. The project owns their production meaning and validates connections against existing project operations. A general graph executor would introduce another authority for generation and cancellation.

**Treat every reference image as the first frame.** First-frame generation and character/scene reference generation have different provider semantics. Unsupported reference combinations fail before the paid request.

**Expose arbitrary FFmpeg parameters.** Filter expressions and indirect file inputs can perform I/O beyond a simple input allowlist. Fixed rendering operations provide the required export without granting that general execution capability.

## Consequences

Authors can organize and regenerate individual shots while preserving accepted results, then export selected versions in explicit order. Reference consistency still depends on the configured model. One Session owns one project; sharing, fork inheritance, transitions, voice synthesis and music mixing require separate operations. Adopted clips retain non-destructive cuts, volume and timed captions. Individual generation and export calls await completion; persisted batches resume only unsubmitted shots after explicit continuation. Actual export requires host-local FFmpeg and FFprobe.

## Verification

Filesystem escape fixtures use directory links, with junctions on Windows, so their real-path denial remains testable without file-symlink privileges. Validation unlinks owned directory links before removing temporary roots.

Protocol, Loader, and UI tests cover reference ordering, cancellation and unload, failed retries, Session isolation, revision conflicts, recovery, bounded media reads, Blob lifetime, film ordering, and renderer cleanup. The authored [production snapshot](../../../../snapshots/session/video-production/snapshot.yml) replays a two-shot plan through the shipped headless profile and compares durable tool output. Its responses are recorded test inputs, not a real-model quality or paid-generation demonstration. The opt-in [real film test](../../../../apps/web/tests/video-film-export.e2e.ts) uses explicitly selected FFmpeg executables to create local clips with different dimensions and frame rates, one short audio track, and one silent clip, then verifies real MP4 encoding, duration, browser playback, byte-identical download, and retention of an earlier film after renderer failure. Synthetic clips do not verify AI output quality.

The [Web planning snapshot](../../../../snapshots/web/video-workflow/snapshot.yml) owns a minimal persona, a single project tool, and its declared full-access permission preset. It executes the recorded plan through the Web Session API, compares persisted tool metadata with the project, and renders the resulting workflow nodes. The separate [browser workflow test](../../../../apps/web/tests/video-production.e2e.ts) uses the ordinary Web composition to verify native port connections, reference order, batch generation, disconnect/reconnect, selection deletion, navigation, playable fixture media, and downloads. Reference-lane geometry and versioned view preferences have focused regressions; adopting a new view format cannot replace Host project data.

The opt-in [ComfyUI diagnostic](../../../../apps/web/tests/video-comfyui.e2e.ts) uses the shipped Web composition with an explicitly selected loopback service and approved renderers. Native black frames pass through the actual ComfyUI provider, persistent generation version, FFmpeg export, attachment storage, and authorized media reads. This validates the local protocol and encoding path without a model download or an AI inference claim.
