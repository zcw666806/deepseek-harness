# Agent Note: Managed capabilities and portable production projects

Status: implemented

English | [中文](2026-10-29-managed-capabilities-and-project-portability.zh.md)

## Problem

A production project depends on more than its canvas: model routes, workflow definitions, local execution environments and durable media must remain distinguishable when moving to another machine. Project data must not grant an imported package authority to select host executable commands, replace credentials or terminate unrelated processes.

## Decision

The [capability manager](../../../../packages/capability/capability-manager/README.md) owns an effect-scoped directory and fixed management operations. Installed providers contribute actual inspection and lifecycle callbacks. Operations serialize per provider, while unrelated providers can progress independently. Removal closes admission, cancels queued and active work, and awaits settlement before a replacement can own subsequent operations. The [capability settings section](../../../../packages/client/ui-capabilities/README.md) consumes these operations through the global Remote assembly, independently of whether another feature view is mounted.

An existing blank Session can select registered non-Chat views without sending a prompt. The conversation shell, header and body share one Session-store axis, including session-maybe declarations. Without a Session, the renderer exposes an identity-stable frozen initial snapshot and throwing actions; it neither creates a persistent instance nor reads the unsuffixed storage key. Root-scope stores cannot share that handle. Default Chat retains its Hero, and selecting a non-Chat view changes presentation rather than manufacturing conversation activity. This refines the [slot authority decision](../architecture/2026-07-22-slot-type-chain-implementation.md) while preserving one instance per handle and Session.

Workspace navigation checks whether a Session contains a project separately from whether its transcript is empty. Domain owners contribute disposal-scoped reuse guards and presentation sources. The video directory reads bounded saved-project summaries from the Host, reconstructs its projection after reconnect and applies committed project responses. A project keeps its sidebar title, search entry and navigation access without inventing a conversation turn. Reuse guards reject saved projects and pending mutations, while Core Session state remains unchanged. Session rename and transcript fork remain separate from project title editing and project-package restoration.

The [managed ComfyUI runtime](../../../../packages/video/video-comfyui-runtime/README.md) keeps reviewed artifact identity and machine bindings outside portable project data. Preparation verifies the offline cache, rebuilds a matching private environment and checks installed payloads. Startup uses bounded version-checked local readiness and the managed subprocess service; cancellation and unload await the process tree. An already running service can be connected without adoption or termination. The workflow provider can request this capability before generation, while another generator remains free to use a different engine.

Portable capability manifests contain provider and engine identities, optional versions and provider-owned declarative configuration. Restoration validates all manifest structure before mutation and reports each missing, unsupported, failed or restored entry. A provider validates its complete configuration before committing it. The [workflow control decision](2026-11-03-production-workflow-controls-and-durable-batches.md) adds a read-only target compatibility preview before explicit configuration restoration. Restoration does not prepare or start an engine. ComfyUI workflow settings restore disabled; operation inputs, transport credentials and machine paths are excluded. Settings resolution clones immutable snapshots before Schemastery normalization. The pi-ai contribution restores model definitions through its existing namespace, retaining target machine bindings and credential references without exporting credential values or refreshing OAuth.

The [video project owner](../../../../packages/video/video-production/README.md) exports a versioned binary container with a bounded manifest and deduplicated raw media. Every frame length, hash and project relationship validates before attachment admission. Restoring requires an existing empty target Session, rechecks its lifecycle in the mutation queue, remaps media to canonical target attachments and commits the complete project once. Running attempts become interrupted; they are never resubmitted. Historical films retain source-version identities even when the corresponding shot has been deleted. The optional capability manifest is returned for explicit restoration, outside the atomic project commit.

Transfer tickets are temporary and Session-bound. Reads, writes, commit, expiry and cancellation share serialized transfer ownership; cancellation is idempotent for an absent ticket and rejects a live foreign ticket. UI controllers retain outstanding cleanup operations during disposal, await known ticket cancellation before unmounting transport, and keep reconnect generations independent. Ticket expiry remains a bounded fallback for a disconnected client whose response was lost.

## Alternatives considered

**Merge engine runtimes into the assistant process.** Provider identity and process ownership allow a single product entry without binding DSH to one inference framework, Python environment or model family.

**Copy virtual environments as project state.** Interpreter locations, native wheels and hardware support belong to the target machine. A reviewed artifact cache can rebuild the environment; project media and declarative settings move separately.

**Restore host commands or activate imported workflows automatically.** A project package carries data and requirements. Installed providers retain authority over preparation, startup and credential binding, and restored workflow configuration requires explicit activation.

**Replace an existing target project while importing.** Empty-target admission and a final lifecycle/revision check preserve existing work and give a single project commit a clear owner.

## Consequences

Authors manage installed capabilities and project restoration from DSH. The first providers cover model settings, workflow configuration, local execution and film export; more providers can use the same directory without changing the agent loop. Matching hardware artifacts and base runtimes remain prerequisites. The reviewed local preparation path targets Windows CPU artifacts and performs no network, driver, custom-node or model installation. The package transfers production records and media rather than an entire Session transcript, operating-system image or credential store.

## Verification

Loader compositions exercise capability registration, replacement and disposal, workflow restoration with target credentials, and project recovery into a new Session followed by cold restart. Migration regressions cover corrupted frames and hashes, lifecycle reuse, concurrent duplicate writes, cancellation, expiry, bounded admission and media-reference remapping. Separate concurrent test processes verify private filesystem resources. The browser scenario exercises capability actions, declarative configuration transfer, project download, empty-target restoration and media preview. Optional native ComfyUI tests use explicitly selected reviewed artifacts and model-free frames; they do not establish AI quality or inference performance.
