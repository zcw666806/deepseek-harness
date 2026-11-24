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

Set `comic-production.imageGeneration` in the Web profile to enable **Generate four panels** beneath a finished storyboard. Supply `baseURL` through the API version path, `model`, and a Host `credentialRef`. The service calls the OpenAI-compatible `images/generations` route and requests a single base64 image. For a provider that returns a URL, configure the exact HTTPS origin in `imageOrigins`. The request and optional download share a deadline that defaults to 180 seconds.

To offer a choice of artwork models, configure `comic-production.imageGenerationTargets` with the same connection fields plus a unique `id` and a display `title` for each route. An `imageGeneration` entry is listed under the reserved ID `default`. With multiple configured routes, choose an image model in the Comic studio for each Session. That choice is saved with the Session lifecycle and applies to both automatic and manual generation. A sole configured route can be used without a selection. Choose another model if the saved route is removed or its credential becomes unavailable.

Ask for a finished comic in a Workspace Session to generate artwork as soon as the assistant finishes its four-panel storyboard. Ask to review the storyboard first to leave the artwork for the **Generate four panels** button. Reopening a Session loads its saved projects.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The Host checks Workspace membership before exposing a project or its image data to a Session. It checks the saved revision before applying an edit. The browser reads project data through the generated Remote interface and keeps local changes until the Host accepts them.

The project retains original PNG bytes separately from editable page geometry and lettering. A new layer revision keeps the previous artwork available. The project package carries the image data needed to reopen the project independently of the original Host.

Generation crops one returned image into four separate PNG layers and commits a project keyed to the Workspace, Session, and source message. Concurrent requests for that source share the same attempt. A successful project is available from the original reply after reload. A provider failure leaves the storyboard available for retry.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

When an image route is configured, the service supplies the storyboard format as a system prompt section. After a completed turn, the Host checks the human request and the assistant's admitted reply before initiating generation.

##### Storyboard guidance

```markdown
When the human directly requests a finished comic, default to four panels if no count is given. For a four-panel comic, plan it in the final reply. The application uses that reply to draw supported requests and shows the artwork when it is ready.
When the human asks to review or confirm a storyboard before drawing, present the storyboard and stop for their review. For instructions about making comics, answer the question normally.
For a storyboard, use a title on a separate line in 《Title》, then a brief art direction line with consistent characters. Give exactly four headings: Panel 1, Panel 2, Panel 3, Panel 4. Under each heading use Scene:, Action:, and Dialogue: on separate lines. In Chinese, use 第一格、第二格、第三格、第四格 and 画面：、动作：、对白：. Write each heading on its own line and use None or 无 for silence. End with the fourth panel and report only the planning you performed.
```

#### Token effect

Each request that includes this section pays the fixed token cost of the guidance.

#### KV Cache effect

The guidance is stable across turns with the same configuration. Enabling or disabling the section changes the prefix from that position.

### Image generation request

#### What the model sees

The configured image model receives the storyboard title, scene descriptions, actions, art direction, and `2×2` layout instructions. The editor typesets the dialogue separately from the returned image. Standalone `storyboard.md` links stay in the conversation.

#### Token effect

The image request includes fixed layout instructions and the text of the storyboard fields sent to the provider.

#### KV Cache effect

The image model request uses the image provider's own cache behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The artwork layer exchange uses PNG images. Native drawing documents and print production require separate capabilities.
- Generation produces the four panels together in one request. Replace a single panel by importing a PNG into its artwork layer.
- Simultaneous editors resolve conflicts against the current saved revision. The Host does not merge overlapping edits.

<a id="dev-note"></a>
### Dev Note

None.
