---
description: "Installed capability management, fixed lifecycle operations, and portable provider configuration."
kind: "package-group"
---

# packages/capability

English | [中文](README.zh.md)

## Summary

This group owns the installed capability directory, provider lifecycle actions, and declarative configuration transfer. The [capabilities subsystem](../../docs/subsystems/capabilities.md) describes ownership and composition.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

## Packages

| Package | Role | ctx key |
|---|---|---|
| [capability-manager](capability-manager/README.md) | Effect-owned directory, fixed management actions, and portable configuration | `ctx.capabilities` |

## Related documentation

- [ComfyUI runtime](../video/video-comfyui-runtime/README.md) manages only its own local processes.
- [Video production](../video/video-production/README.md) owns portable projects and durable media.

## Dev Note

None.
