# Capabilities

English | [中文](capabilities.zh.md)

The [capability-manager](../../packages/capability/capability-manager/README.md) owns an effect-scoped directory of installed providers. Providers contribute descriptions, inspected prerequisites, and fixed check/prepare/start/stop callbacks. The [management UI](../../packages/client/ui-capabilities/README.md) consumes the same Remote operations. A provider registration does not start an engine.

## Runtime ownership

The capability manager serializes management operations for each provider under configured deadlines. Removal stops admission, aborts queued and active work, and awaits settlement. A replacement registration with the same identity cannot inherit the removed provider's operations. Local process ownership remains with the provider that started the process tree; an already running external service can be connected without being adopted or terminated.

The [ComfyUI runtime provider](../../packages/video/video-comfyui-runtime/README.md) separates machine paths and verified offline artifacts from portable workflow settings. It uses the configured subprocess and filesystem services, local readiness checks, private runtime data, and awaited teardown. The [ComfyUI workflow provider](../../packages/video/video-comfyui/README.md) can start the configured runtime capability before generation; another generation provider can use the same project service without that engine.

## Portable configuration

`PortableCapabilityManifest` records provider identity, engine identity, optional engine version, and settings explicitly exported by the owning provider. It does not carry executable installation commands. Providers omit transport credentials and machine paths, then validate imported JSON before committing settings. Missing providers, different engines or versions, rejected settings, and successful restores remain separate results. Configuration restoration never prepares or starts a runtime.

The [video project package](../../packages/video/video-production/README.md) additionally transfers project records and deduplicated media. Restoring a project and applying its optional capability manifest are explicit operations. Environment directories and model weights remain separate from project media, so target machines can rebuild a matching environment or bind another configured engine.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcapabilities--capabilitymanager"></a>

### `ctx.capabilities` — `CapabilityManager`

Capability directory shared by the Web management UI and installed engine providers.

```ts cordis-catalog
/**
 * Register an installed implementation; its callbacks retain process and credential ownership.
 * @param provider - Typed installed provider whose inspections contain only public diagnostics.
 * @returns Async disposer removing this registration, cancelling its operations, and awaiting settlement.
 */
register(provider: CapabilityProvider): () => Promise<void>

/**
 * Inspect every current installed capability without installing or starting it.
 * @param signal - Caller cancellation; each inspection also observes checkTimeoutMs.
 * @returns Current descriptions, actual callback-derived actions, and safe readiness observations.
 */
@Remote('list') async list(signal: AbortSignal): Promise<readonly CapabilityView[]>

/**
 * Execute one fixed operation through its current installed provider, serialized per capability.
 * @param id - Current registered capability identity.
 * @param action - Check, prepare, start, or stop; unsupported operations reject before provider invocation.
 * @param signal - Caller cancellation and configured complete-operation deadline.
 * @returns Post-operation inspection, or a safe error view when provider work fails.
 */
@Remote('perform') async perform(id: CapabilityId, action: CapabilityAction, signal: AbortSignal): Promise<CapabilityView>

/**
 * Export current engine requirements and provider-declared portable configuration.
 * @param signal - Caller cancellation; each provider read has the inspection deadline.
 * @returns A bounded manifest without runtime commands, environments, weights, or implicit credential copying.
 */
@Remote('exportManifest') async exportManifest(signal: AbortSignal): Promise<PortableCapabilityManifest>

/**
 * Preview installed engine compatibility and current prerequisites without changing target-machine state.
 * @param manifest - Complete untrusted portable manifest, validated before any provider inspection.
 * @param signal - Caller cancellation; each inspection includes its configured queue and execution deadline.
 * @returns Credential-free compatibility results; pending settings still require explicit provider validation during restoration.
 */
@Remote('planRestore') async planRestore(manifest: PortableCapabilityManifest, signal: AbortSignal): Promise<CapabilityRestorePlan>

/**
 * Restore matching installed providers' declarative settings; no runtime is installed or started.
 * @param manifest - Untrusted complete portable manifest; invalid or duplicate entries reject before any callback.
 * @param signal - Caller cancellation; each provider restore has the configured action deadline.
 * @returns Per-provider results. Missing engines and version mismatches remain explicit; independent restores can partially succeed.
 */
@Remote('restoreManifest') async restoreManifest(manifest: PortableCapabilityManifest, signal: AbortSignal): Promise<readonly CapabilityRestoreResult[]>
```

Source: [`packages/capability/capability-manager/src/index.ts`](../../packages/capability/capability-manager/src/index.ts)
<!-- END GENERATED cordis-surface -->
