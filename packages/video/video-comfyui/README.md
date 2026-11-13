---
description: "Optional ComfyUI HTTP video generation through operator-owned API workflows, bounded media transfer, and job-scoped cancellation."
kind: "package-reference"
---

# @deepseek-ai/dsh-video-comfyui

English | [中文](README.zh.md)

## Summary

This optional provider connects an existing ComfyUI service to `ctx.videoProduction`. An operator supplies the endpoint, an exported API-format workflow, explicit input bindings, and one video output selection. The adapter uploads admitted project reference images, submits one job, waits for its own history, and saves the selected MP4 or WebM through the existing attachment service. It installs no ComfyUI code, custom nodes, models, or GPU runtime.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this provider beside `video-production` and `attachments` through a `dsh` profile. It defaults to `enabled: false`; loading or listing its targets makes no network requests. Enable it only for an operator-managed service whose workflow dependencies and authorization are already configured. The protocol is reviewed against [ComfyUI v0.43.0, commit 426f5eea52a7ece1dd599fff4cb6cd1f352ddd24](https://github.com/Comfy-Org/ComfyUI/tree/426f5eea52a7ece1dd599fff4cb6cd1f352ddd24).

```yaml
- id: video-comfyui
  name: '@deepseek-ai/dsh-video-comfyui'
  config:
    enabled: false
```

An enabled configuration requires `baseURL` and a nonempty `workflows` array. `baseURL` accepts HTTP or HTTPS with an optional path prefix, excluding embedded credentials, query, and fragment. Optional `headers` apply only to that configured origin; redirects are rejected. Keep authentication values outside committed configuration. Transport-owned headers such as `Host`, `Content-Type`, and `Content-Length` cannot be overridden.

### Workflow configuration

The optional `video-comfyui` settings namespace follows the current operator configuration without restarting DSH. Each generation captures one validated snapshot. Disabling workflows unregisters the generator and cancels its active attempts; plugin unload waits for settlement. With `managedCapability` configured, generation starts or connects that DSH-managed runtime before submitting work.

With persistent settings mounted, `videoWorkflows` provides a revisioned editor for the service URL and API workflows. Reads clear operation inputs and metadata and refuse templates containing credentials or absolute machine paths; request header values never leave this editor. Validation checks the endpoint and mappings without contacting ComfyUI. Saving retains host headers and the runtime binding, rejects stale revisions, and disables generation until explicit activation. Activating workflows only registers targets; it does not start the engine. The built-in black-frame diagnostic template checks media transport without AI generation or model weights.

The capability center contributes `video.comfyui` for workflow configuration independently of the engine process. Its check inspects configured node types and enumerated model inputs when enabled. Configuration export clears operation-specific inputs and excludes endpoint headers and machine bindings. Export and restoration reject credential input fields, including token names, regardless of the value's JSON type; generation token limits and token arrays remain portable. Restoration validates the workflow data and persists it disabled, retaining the target's endpoint, credentials and runtime binding. Explicit activation is required before it appears in the generation target directory.

Each workflow has a unique `id`, a display `title`, and `template`, the API-format node dictionary exported by ComfyUI. Every node contains `class_type` and `inputs`; frontend graph JSON is rejected. The template remains operator-owned: a model cannot provide nodes, change bindings, choose URLs, or replace the workflow. The following fields select existing scalar inputs with `{node, input}`:

| Field | Meaning |
|---|---|
| `prompt` | String input receiving the shot prompt. |
| `duration` | Numeric input with `unit: seconds`, or `unit: frames` and explicit positive `fps`; frames equal seconds × fps + `frameOffset`, whose default is 0. Seconds bindings forbid frame settings. |
| `width`, `height` | Numeric inputs receiving the exact selected dimension pair. |
| `references` | Ordered string inputs for uploaded image paths; the request must supply exactly this many references. An empty array declares a text-only workflow. |
| `outputPrefix` | Required save-node string input receiving `dsh/<operation UUID>/video`; the selected output must stay under this operation's directory. |

Bindings must be distinct existing scalars, rather than linked inputs or arbitrary property expressions. `durations` declares unique integer seconds from 1 through 15. A frame conversion must produce a positive whole frame count for every declared duration. `sizes` declares unique `{aspectRatio, resolution, width, height}` entries, where dimensions are integers from 1 through 16,384. The target directory exposes the separate aspect-ratio and resolution lists; the adapter additionally validates their exact configured pair before uploading anything.

`output: {node, key, index}` selects one array item from that job's successful raw history. The reviewed native `SaveVideo` node uses `key: images`; custom save nodes can use a different explicit key. The item must name an MP4 or WebM basename with `type: output` and a safe relative subfolder under the operation directory. Other node outputs, arbitrary URLs, input/temp files, annotated paths, and hash-based `/view` references are never selected.

The provider registers generator `comfyui`, with each workflow `id` exposed as its selectable model. Each target includes a SHA-256 revision over the serialized workflow configuration, its durations, declared sizes, and exact reference count. The existing project service freezes this revision on the attempt. Changing endpoint headers does not expose them in target metadata.

### Transport limits

All limits validate before registration. `timeoutMs` bounds upload, submission, polling, download, and attachment storage; its default is 300,000 ms. `cleanupTimeoutMs` supplies an independent cancellation budget of 10,000 ms. `pollIntervalMs` defaults to 1,000 ms. These integer durations accept 1 through 2,147,483,647 ms. `maxJsonBytes` defaults to 1,048,576 bytes, accepts 1 through 16,777,216, and bounds each JSON request, response, and serialized workflow. `maxUploadBytes` bounds the aggregate reference-image bytes at 20,971,520 by default; `maxVideoBytes` bounds the downloaded video at 536,870,912 by default. Both accept integers from 1 through 2,147,483,647. The generated [configuration catalog](../../../docs/config-catalog.md) lists the fields.

<a id="understand-the-implementation"></a>
## Understand the implementation

The adapter allocates random job and client UUIDs before submitting exactly one `POST /prompt`. It uploads ordered references to a private input subfolder through `/upload/image`, with `overwrite: false`. Polling reads only `/history/<own job UUID>` and verifies the stored job and client identities. A successful terminal status precedes output selection and `/view` download. JSON and binary responses are streamed under byte limits, redirects are rejected, and output bytes must match MP4 or WebM before attachment storage publishes a reference.

Cancellation uses only `POST /api/jobs/<own job UUID>/cancel` and `/api/jobs/<own job UUID>`. In the reviewed server version, the queue checks the live job identity and interrupts it under the same mutex, preventing a completed job's cancellation from hitting its successor. A dispatched cancellation is not treated as terminal until the own-job status is terminal or its acknowledged/dequeued job is absent. The adapter never calls legacy `/interrupt`, clears a queue, deletes global history, or retries a submission.

During caller cancellation, an outstanding submission can finish acknowledging within the independent cleanup budget. If the response is lost, cleanup checks only the preallocated job identity. A service may still be validating an unacknowledged submission when that budget expires; the resulting diagnostic states that remote termination is unconfirmed. Unloading unregisters targets, aborts local attempts, and awaits their bounded cleanup. Job/client UUIDs identify requests; they do not authenticate users or provide server-side tenant isolation.

<a id="further-exploration"></a>
## Further Exploration

- [Video production](../video-production/README.md) owns durable project attempts, target selection, and film export.
- [Attachments](../../attachment/attachment/README.md) owns admitted image reads and durable video storage.
- [Official server routes](https://docs.comfy.org/development/comfyui-server/comms_routes) describe the local API.
- [Reviewed atomic job cancellation](https://github.com/Comfy-Org/ComfyUI/blob/426f5eea52a7ece1dd599fff4cb6cd1f352ddd24/server.py#L1036) and [queue implementation](https://github.com/Comfy-Org/ComfyUI/blob/426f5eea52a7ece1dd599fff4cb6cd1f352ddd24/execution.py#L1378) establish the supported cancellation semantics.

<a id="model-experience"></a>
## Model Experience

### Configured generation targets

#### What the model sees

This provider adds no tool or system prompt. The existing `video_project` tool can explicitly select generator `comfyui` and an operator-configured workflow identity. Project results contain ordinary attempt metadata and a durable video reference; workflow contents, request headers, remote media paths, and video bytes are absent from those results.

#### Token effect

The provider contributes no request-prefix tokens. Logged project results include the selected generator, workflow identity, configuration revision, and outcome, bounded by `video-production` project limits.

#### KV Cache effect

Provider registration does not rewrite session history or the stable project tool schema. Each completed tool call appends its ordinary result; the calling model's provider owns cache behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **An existing approved service and working workflow are required** — this package neither installs ComfyUI nor discovers, installs, or validates the runtime availability of nodes and models. Workflows may themselves invoke external or paid services; operators own those choices.
- **Cancellation requires the reviewed atomic jobs API** — older servers without it return an explicit unconfirmed-termination error. No unsafe global-interrupt fallback is provided, and an uncooperative node can outlast the cleanup deadline.
- **The server is a trusted operator endpoint** — job UUID checks prevent accidental cross-job selection, while authentication and multi-user isolation remain the operator's responsibility.
- **Remote files remain on the ComfyUI service** — uploaded references and generated outputs are not deleted by this adapter; operators manage retention. The adapter exposes no arbitrary file-delete endpoint.
- **Progress uses own-job history polling** — WebSocket node progress, preview streaming, automatic restart recovery, workflow editing, video-input editing, and extension are not provided.
- **Only scalar-bound, fixed-count references and MP4/WebM output are supported** — workflow-specific collections, frame quantization beyond an explicit offset, and other media formats require an explicit integration change.
- **Default protocol tests use a local HTTP fixture** — the opt-in [Web diagnostic](../../../apps/web/tests/video-comfyui.e2e.ts) exercises an existing loopback ComfyUI service, project persistence, and real FFmpeg export using native black frames. It requires explicit endpoint and renderer paths and does not validate AI quality or inference speed.

<a id="dev-note"></a>
### Dev Note

None.
