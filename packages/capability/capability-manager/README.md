---
description: "Installed capability management, bounded lifecycle operations, and portable provider settings for the DSH control interface."
kind: "package-reference"
---

# @deepseek-ai/dsh-capability-manager

English | [中文](README.zh.md)

## Summary

`ctx.capabilities` is the shared directory of installed DSH capabilities. Providers contribute descriptions, prerequisite inspections, and fixed prepare/start/stop callbacks. The management UI reads the same directory and invokes those callbacks without accepting arbitrary process commands. Portable manifests carry engine requirements and settings explicitly exported by their owning providers.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this service through a `dsh` profile beside the providers that contribute capabilities. Each installed provider calls `register` with a stable branded identity, an engine identity, a public description, and `inspect`. Optional lifecycle callbacks determine the available actions. Registration returns an asynchronous disposer; the provider awaits it when unloading before disposing runtime resources that active management work can still use.

`list` inspects all current providers without preparing or starting them. `perform` accepts one registered identity and one of `check`, `prepare`, `start`, or `stop`. An unsupported action or absent provider rejects before a callback runs. Provider exceptions become a generic error observation, keeping raw exception details out of the management response. Providers return safe actionable diagnostics and prerequisite details through their inspections; they must exclude credentials and executable configuration from those observations.

### Portable settings

`exportManifest` produces format `dsh-capabilities`, version `1`, and one requirement per current provider: capability identity, engine identity, optional engine version, and optional provider-declared JSON configuration. A provider without `exportConfiguration` contributes only its requirement. Providers own removal of credentials, local paths, and other machine bindings before exporting settings.

`planRestore` validates the complete manifest before inspecting target providers. It reports missing providers, incompatible engines or versions, current prerequisites and available actions without applying configuration. `compatible` means the installed provider accepts that engine identity and restoration operation; imported settings remain `pending-validation` until explicitly restored. The preview does not return imported configuration values or prepare or start engines.

`restoreManifest` validates the whole JSON declaration and unique identities before invoking any provider. A missing provider returns `missing`. A different engine or declared version returns `unsupported`, as does configuration addressed to a provider without a restore callback. Matching settings go to `restoreConfiguration`; that callback validates and commits its own complete update. Independent providers may restore successfully even when another provider rejects its settings. The returned `restored` status describes configuration acceptance, while `list` independently reports runtime readiness.

Restoring a manifest does not install plugins, prepare an environment, or start a runtime. Those remain explicit fixed operations. Project-transfer code reuses `parsePortableCapabilityManifest` from the `./portable` export rather than maintaining another schema. The parser owns format, field, JSON-value, and duplicate-identity validation; the transfer owner applies its complete package byte and item limits.

### Configuration

`maxProviders` bounds the registered directory and restored inventory. `checkTimeoutMs` bounds an inspection including time waiting behind earlier operations. `actionTimeoutMs` bounds prepare/start/stop or configuration restoration, including queue wait and post-action inspection. `maxResultBytes` bounds the complete UTF-8 JSON result or imported manifest, including its wrapper and all provider descriptions. The generated [configuration catalog](../../../docs/config-catalog.md) owns exact defaults and ranges.

<a id="understand-the-implementation"></a>
## Understand the implementation

Every provider registration owns a cancellation controller and one operation tail. Calls for the same identity serialize; separate capabilities can progress independently. A caller cancellation or configured deadline signals the active provider, and the operation returns only after the callback settles. Providers must observe cancellation and await their own processes or requests before returning. The manager does not terminate processes directly.

Unregistering removes the visible identity immediately, cancels queued and active operations, and awaits their settlement. A replacement with the same identity has a separate lifetime; the retiring registration cannot remove it. Service unload stops admission and drains remaining registrations. No process handles, machine configuration, or capability inventory are persisted by this service; installed provider plugins reconstruct the directory.

<a id="further-exploration"></a>
## Further Exploration

- [Capability management](../../../docs/subsystems/capabilities.md) describes provider and consumer composition.
- [ComfyUI workflow provider](../../video/video-comfyui/README.md) owns video workflow settings and generation.
- [Managed ComfyUI runtime](../../video/video-comfyui-runtime/README.md) owns local environment and process supervision.

<a id="model-experience"></a>
## Model Experience

### Management results

#### What the model sees

The service registers no model tool or prompt section. Its management operations return `CapabilityView` observations and a `PortableCapabilityManifest` containing provider-declared settings and engine requirements. These values reach a model only when an invoking code tool includes them in its logged output; that tool owns the presentation and transcript entry. Direct UI management does not create a model message.

#### Token effect

The service contributes zero direct request-prefix tokens. An invoking code tool may add its returned management data to history; `maxResultBytes` bounds each complete service result, while the code tool owns its model-output limits.

#### KV Cache effect

Directory reads and management operations do not rewrite model history or requests already in flight. Logged code-tool results append through that tool's normal output. Each provider owns the effect of its restored settings on subsequent requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Installed providers define the available capabilities** — a portable inventory reports missing providers and versions; it does not fetch or execute installation instructions from imported data.
- **Cancellation depends on provider cooperation** — deadlines signal cancellation and the manager awaits settlement; an uncooperative callback can delay its caller and unload.
- **Restoration is atomic per provider** — there is no cross-provider transaction or rollback after another provider has accepted settings.
- **Portable settings exclude runtime payloads** — providers and transfer owners handle model files, environment reconstruction, attachment data, and machine-local credential binding.

<a id="dev-note"></a>
### Dev Note

None.
