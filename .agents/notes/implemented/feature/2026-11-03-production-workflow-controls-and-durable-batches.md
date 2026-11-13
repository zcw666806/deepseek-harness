# Agent Note: Safe workflow controls, durable batches, and clip edits

Status: implemented

English | [中文](2026-11-03-production-workflow-controls-and-durable-batches.zh.md)

## Problem

Production controls must distinguish saved configuration from enabled targets and running engines. A disconnected browser must not lose ownership of a paid batch, and a Host restart must not silently submit a request whose outcome is unknown. Editing an accepted clip must preserve both its source and the settings used by an earlier exported film.

## Decision

The [workflow editor](../../../../packages/video/video-comfyui/src/workflows.ts) exposes the service URL and portable API workflows through revisioned settings. It excludes request-header values, retains host credentials and runtime bindings, and rejects unsafe workflow credentials and machine paths. Saving validates the candidate, checks the settings revision, and persists it disabled. Explicit activation registers targets without starting an engine. The native black-frame starter identifies itself as a diagnostic without AI generation; it establishes no model availability or output-quality claim.

The [capability restore preview](../../../../packages/capability/capability-manager/src/index.ts) validates manifest structure and inspects installed providers without restoring settings, preparing environments, or starting runtimes. Engine identity, version, and restoration support determine compatibility. Imported configuration remains `pending-validation` until the provider admits it during explicit restoration. A compatible entry can still have missing prerequisites or a stopped runtime; compatibility is neither validated configuration nor readiness.

The [batch owner](../../../../packages/video/video-production/src/tasks.ts) persists one descriptor per project Session lifecycle and runs pending shots independently of the browser. Each descriptor freezes the generation route, workflow revision, shot inputs, and ordered references. The Host persists a shot's `running` checkpoint before generation. Recovery classifies an unfinished checkpoint as `uncertain` and does not replay it. Resume revalidates project ownership, frozen inputs, target revision, and recorded completed results; only `pending` shots are eligible for submission. Pausing stops admission after the current shot settles. A pause request or local shutdown is not proof that a remote request stopped.

Batch descriptors and runners have different lifetimes. Persisting an existing jobs callback or closure cannot make its executable state recoverable; the production service owns explicit data and recovery rules. This deliberately favors an operator review over an automatic second paid request when the Host cannot prove the first outcome. Cancellation stops pending work after the current shot settles; unload aborts provider work and awaits the service's runners and durable writes.

Clip edits are [non-destructive data](../../../../packages/video/video-production/src/editing.ts): source-relative trim, volume, and captions leave the adopted attachment unchanged. Caption timing is relative to the trimmed clip. The renderer writes caption text to private UTF-8 files and uses fixed `textfile` filters with `expansion=none`; user text does not become a filter expression. An export captures `clipEdits` alongside its source-version identities, so later project edits do not change the recorded film inputs.

These decisions refine the [Session-owned production workspace](2026-10-27-video-production-workspace.md) and [managed capabilities and portability](2026-10-29-managed-capabilities-and-project-portability.md). Both records remain active because their Session authority, media ownership, runtime isolation, and migration rationale remain independently useful.

The conversation shell restricts transcript width handles to Chat. Other registered Views retain their own content layout and controls without transcript drag regions intercepting pointer input.

## Alternatives considered

**Activate imported or edited workflows during save.** Configuration editing would acquire execution effects and could start a machine-bound runtime before the operator chooses to use it. Save and activation remain separate operations.

**Treat a compatible restore preview as validated and ready.** Provider configuration admission and runtime prerequisites are separate checks. The preview preserves those unresolved facts rather than granting execution authority.

**Keep batch progress in browser callbacks or replay running checkpoints after restart.** Browser lifetime cannot own durable work, and an unfinished local record cannot prove that a paid remote submission did not occur. Explicit persisted checkpoints support conservative recovery without serializing closures.

**Overwrite accepted media or interpolate caption text into renderer filters.** Overwriting loses provenance, while filter interpolation gives text unintended syntax. Immutable sources, captured edit records, and literal caption files preserve reproducibility and constrain renderer input.

## Consequences

Authors can edit workflows, inspect restoration requirements, pause batches, and adjust exported clips without conflating configuration, execution, and media ownership. Uncertain attempts require provider inspection and explicit user judgment; automatic recovery cannot guarantee remote exactly-once execution. Batches retain pending work rather than promising to resume arbitrary tasks or callbacks. Rendering still requires approved local FFmpeg and FFprobe.

## Verification

Workflow Loader tests cover safe reads, settings revisions, concurrent-save conflicts, separate settings owners, explicit offline activation, and diagnostic-template validation. Host batch and production tests cover durable checkpoints, recovery, pause/resume admission, and project state. Capability preview tests cover compatibility and pending configuration validation; controller tests cover the corresponding user actions. Renderer tests cover trim, volume, literal captions, and captured export edits. Host strict type checking validates the generated Remote inputs and typed failures.

Browser acceptance exercises configuration preview, disabled saves, explicit activation without engine startup, page closure during background production, retained checkpoints, and pause/resume/cancel at shot boundaries. The [real film scenario](../../../../apps/web/tests/video-film-export.e2e.ts) exports trimmed synthetic clips with Chinese captions, preserves generation history, probes the H.264/AAC result and retains completed films after renderer failure. Project-package tests retain clip edits and reject malformed edit provenance before media admission.

Observed real requests to `grok-imagine-video-1.5` and `grok-imagine-video` both return HTTP 503, `No eligible Grok media accounts`, through the configured gateway despite both appearing in its model directory. No video is produced. Successful real-provider generation and AI output quality remain a coverage gap; synthetic media and native diagnostics do not close it.
