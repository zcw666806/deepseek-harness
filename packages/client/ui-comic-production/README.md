---
description: "Web comic editor for multi-page storyboards, editable lettering, PNG artwork revision, and reader exports."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-comic-production

English | [中文](README.zh.md)

## Summary

Lay out pages and panels, revise dialogue, and replace a panel's artwork without redrawing its balloons. Comic studio saves editable projects through the [comic production service](../../comic/comic-production/README.md). Download a page PNG for reading or a project package for continued editing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Enable the comic packages with the [Web profile overlay](../../bundle/web-app/comic-production.patch.yml). Open a Session in the desired Workspace and choose **Comic studio**. Create a comic or open one saved in the Workspace. Save edits before leaving the project.

Choose a page and panel to edit its layout and dialogue. Select an artwork layer and import a PNG. To revise the layer, export the original PNG, edit it in a drawing application, and import a PNG of the same dimensions into the same layer. Keep the drawing application's editable source alongside the project when you need its native editing features.

Use the reading preview to check the page sequence and lettering. Export a page PNG to share it or export the project package to transfer the editable pages and their artwork. Import the package from the project list to make a separate editable copy.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The Conversation view mounts the comic production Remote and sends revision-checked edits to the Host. Page layout, artwork selection, and dialogue use project coordinates independent of the preview zoom. The PNG renderer resolves adopted layer revisions before compositing the artwork and lettering.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this view edits project data through the browser.

#### KV Cache effect

Opening, editing, or exporting a comic does not change model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The editor supports digital page layouts and horizontal lettering. Native drawing-file exchange and print production require separate capabilities.
- Image revisions enter as PNG files. Create artwork and make detailed brush corrections in a drawing application.

<a id="dev-note"></a>
### Dev Note

None.
