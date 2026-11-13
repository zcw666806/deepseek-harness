---
description: "Inspect configured capabilities and manage their approved runtime actions from DSH settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-capabilities

English | [中文](README.zh.md)

## Summary

The Capabilities settings section shows configured engines, their current health, missing requirements, and available management actions. Users can check, prepare, start, or stop capabilities without supplying executable commands.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this browser feature with the capability-manager Host and the existing settings shell. Open Settings → Capabilities to inspect reports and requirements. The Host advertises supported actions. The section disables other actions while a request runs and lets the user cancel it. Externally managed local services cannot be stopped from this section.

Export capability settings downloads a JSON manifest. Restore capability settings validates the selected JSON file and previews provider identity, version compatibility, current requirements, and whether configuration still needs validation. Apply settings explicitly requests restoration, then refreshes reports and lists restored, missing, unsupported, or failed results. Compatibility does not imply engine or model readiness. Restoration never prepares or starts an engine or downloads models; missing providers and version mismatches remain explicit.

When the video workflow provider is mounted, Settings → Video workflows edits the service URL, target names, API-format template JSON, and prompt, duration, size, reference-image, and output bindings. Validation leaves the draft intact; saving persists disabled configuration. Enable workflows is a separate action available after saving. Failed requests preserve the draft. Header values are never displayed. This editor does not install models or start engines. The black-frame transport diagnostic starter is explicitly non-AI and enters the draft only; it also requires saving and enabling. Reload and discard draft reads the current Host revision after a configuration conflict.

The feature has no plugin-specific configuration. Engine readiness does not imply that a video model or generation workflow is installed; each provider owns its reported requirements.

<a id="understand-the-implementation"></a>
## Understand the implementation

The browser consumes the globally mounted capability Remote and contributes root-scoped `settings.section` entries for capabilities and the optional workflow provider. A controller publishes Host reports through an injected framework hook. It owns cancellation and download URLs, rejects late results after reconnect, waits for pending requests during disposal, and leaves process ownership and dependency validation to the Host.

<a id="model-experience"></a>
## Model Experience

### Capability settings

#### What the model sees

This UI registers no model-facing tool or prompt section and sends no model message. Calls to `capabilities.perform` and `capabilities.restoreManifest` are Host management actions. Their reports and restoration results remain UI state; any later model-visible effect of changed settings belongs to the provider that consumes those settings.

#### Token effect

The UI contributes zero direct model-request tokens. Viewing capabilities, downloading settings, and invoking Host management actions do not append conversation messages.

#### KV Cache effect

Capability viewing state and configuration downloads do not rewrite conversation history or requests already in flight. A restored provider configuration can affect later requests; that provider owns the resulting context and cache behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Reports are request-driven.** Refresh or run an action to inspect changes made outside the section.
- **Restoration is provider-specific.** A manifest cannot install a missing provider or supply a model that the provider does not have.
- **JSON downloads are buffered.** The browser holds the complete manifest until its download URL is released.

<a id="dev-note"></a>
### Dev Note

None.
