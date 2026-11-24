---
description: "Local ComfyUI preparation and process supervision through the DSH capability center, using verified offline artifacts and machine-local bindings."
kind: "package-reference"
---

# @deepseek-ai/dsh-video-comfyui-runtime

English | [中文](README.zh.md)

## Summary

This optional provider makes a local ComfyUI runtime manageable through `ctx.capabilities`. Loading registers inspection, start and stop operations; a configured artifact cache also enables preparation. No engine starts during registration. The [workflow provider](../video-comfyui/README.md) can request this runtime before generation, keeping the DSH workspace as the user entry point.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount it beside `capability-manager`, a host-local filesystem provider and the managed subprocess provider. Its capability identity is `engine.comfyui`. The default runtime directory is `DSH_HOME/runtimes/comfyui`; explicit relative paths resolve against the invoking directory. Bind the base Python executable, runtime directory, offline cache directory and manifest digest on each machine. These bindings do not travel in a project package.

```yaml
- id: video-comfyui-runtime
  name: '@deepseek-ai/dsh-video-comfyui-runtime'
  config:
    directory: .tools/comfyui/0.43.0-cpu
    pythonPath: python
    port: 8188
```

Preparation requires `artifactDirectory`, `manifestName` and `manifestSha256`. The cache contains the hash-bound manifest, `source.zip`, `requirements.lock.txt` and `wheels/`. The installer verifies the source archive, every wheel and the complete version/hash lock before writing a new environment. It creates a private virtual environment and installs wheel files offline with hashes; no package resolver fetches code. An existing completed installation is checked against source and installed wheel bytes. A target without a completed installation marker is retained for inspection rather than overwritten.

Startup verifies the prepared environment, uses CPU mode, binds only `127.0.0.1` at the configured port, disables external custom nodes and online partner nodes, and serves the installed frontend. Environment data and caches stay under the runtime directory. The child environment removes inherited application credentials and Python search paths. Each start uses a private bytecode location and disables bytecode writes.

An already healthy local ComfyUI listener is connected without adopting its process. DSH can stop only a process tree started by this registration. Startup cancellation, explicit stop and plugin unload await the owned process tree before removing private startup data. Closing DSH does not stop an external service it merely connected to.

The generated [configuration catalog](../../../docs/config-catalog.md) owns defaults and field bounds. Readiness checks validate the expected ComfyUI version and bound each response. Workflow node and model prerequisites belong to the separate workflow provider, so a running engine does not imply that AI video models are installed.

## Understand the implementation

`ManagedComfyRuntime` contributes callbacks to the existing capability registry and spawns through the configured subprocess service. The process provider owns Windows descendants and pipe settlement; the runtime owns the handle and private startup directory. The base Python helper runs isolated without site initialization to inspect approved artifacts before candidate libraries can load. It never reads host paths embedded in an artifact manifest as deployment instructions.

Capability exports contain only this engine's identity and version. Restoring them reports whether the target has a matching installed provider; it does not copy a virtual environment, install Python or start an engine. Machine bindings and reviewed artifact identity remain target-machine configuration.

## Further Exploration

- [Capability manager](../../capability/capability-manager/README.md) owns operation admission and portable configuration.
- [ComfyUI workflows](../video-comfyui/README.md) owns generation inputs, job cancellation and video output selection.
- [Video production](../video-production/README.md) owns project packages and film export.
- [Subprocess service](../../subprocess/subprocess/README.md) owns process-tree termination.

## Model Experience

### Managed execution prerequisites

#### What the model sees

This provider contributes no tool or system prompt. The existing [`video_project` tool](../../../docs/tool-catalog.md#deepseek-aidsh-video-production) can indirectly invoke its configured runtime through the workflow provider. Runtime process arguments, environment paths and artifact files are absent from project tool results.

#### Token effect

Registration adds no model request prefix. Only an ordinary recorded tool outcome can introduce a generation or runtime failure into the conversation.

#### KV Cache effect

Runtime preparation and start/stop do not rewrite conversation history. Existing tool results append normally; cache behavior remains with the calling model provider.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The preparation helper targets reviewed Windows CPU artifacts** — it requires the matching base Python version and bootstrap hash. Other hardware or operating systems need their own reviewed artifact set and preparation provider.
- **The cache and base Python must already be available** — this provider performs no network downloads, driver installation, model download or custom-node installation.
- **The runtime directory is not a portable virtual environment** — rebuild it from the reviewed artifact cache on a target machine; project packages carry data and capability requirements separately.
- **Ownership lasts for this DSH process** — normal unload awaits descendants, while a forcibly terminated host can require external process cleanup; an unknown listener is never killed automatically.
- **A failed partial preparation is retained** — inspect its directory before retrying with a clean destination. Imported projects cannot choose or delete that destination.

<a id="dev-note"></a>
### Dev Note

None.
