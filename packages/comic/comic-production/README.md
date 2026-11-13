---
description: "Host-side storage for editable comic projects, original PNG layers, and portable project packages."
kind: "package-reference"
---

# @deepseek-ai/dsh-comic-production

English | [中文](README.zh.md)

## Summary

Save a comic project in a Workspace and reopen it from another Session in that Workspace. The project retains page layout, panel order, editable lettering, and artwork revisions. A project package carries those records and image data for further editing in a different Workspace.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Enable the Host service and the [Comic studio view](../../client/ui-comic-production/README.md) together in the Web profile. Select a Workspace Session to create or open a project. Import a project package to create a separate editable project in the selected Workspace.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The Host checks Workspace membership before exposing a project or its image data to a Session. It checks the saved revision before applying an edit. The browser reads project data through the generated Remote interface and keeps local changes until the Host accepts them.

The project retains original PNG bytes separately from editable page geometry and lettering. A new layer revision keeps the previous artwork available. The project package carries the image data needed to reopen the project independently of the original Host.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as the service exposes project operations to the Web editor.

#### KV Cache effect

Project and artwork edits do not change model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The artwork layer exchange uses PNG images. Native drawing documents, automated image generation, and print production require separate capabilities.
- Simultaneous editors resolve conflicts against the current saved revision. The Host does not merge overlapping edits.

<a id="dev-note"></a>
### Dev Note

None.
