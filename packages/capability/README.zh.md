---
description: "已安装能力管理、固定生命周期操作及可迁移的提供方配置。"
kind: "package-group"
---

# packages/capability

[English](README.md) | 中文

## 概述

本组拥有已安装能力目录、提供方生命周期操作及声明式配置迁移。[能力子系统](../../docs/subsystems/capabilities.zh.md)说明职责和组合方式。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [capability-manager](capability-manager/README.zh.md) | effect 拥有的目录、固定管理操作及可迁移配置 | `ctx.capabilities` |

<a id="related-documentation"></a>
## 相关文档

- [ComfyUI 运行环境](../video/video-comfyui-runtime/README.zh.md)仅管理自己拥有的本地进程。
- [视频制作](../video/video-production/README.zh.md)拥有可迁移项目和持久媒体。

<a id="dev-note"></a>
## 开发备注

无。
