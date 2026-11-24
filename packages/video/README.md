---
description: "Video production packages: persistent storyboards, reference assets, generated shot versions, and film exports."
kind: "package-group"
---

# packages/video

English | [中文](README.zh.md)

## Summary

The video group owns Session-scoped production projects, connecting reusable reference assets, editable shots, generation providers, and ordered film exports.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [video-production](video-production/README.md) | Project service, persistent project provider, model tools, and Remote operations | `ctx.videoProduction` |
| [video-comfyui](video-comfyui/README.md) | Optional HTTP generation provider using operator-configured ComfyUI workflows | contributes to `ctx.videoProduction` |
| [video-comfyui-runtime](video-comfyui-runtime/README.md) | Local runtime preparation and owned process supervision | contributes to `ctx.capabilities` |

<a id="related-documentation"></a>
## Related documentation

- [Video production subsystem](../../docs/subsystems/video-production.md) owns project data and operation semantics.
- [Video workspace](../client/ui-video-production/README.md) owns canvas interaction and media presentation.

<a id="dev-note"></a>
## Dev Note

None.
