---
description: "视频制作包组：持久分镜、参考素材、镜头生成版本与整片导出。"
kind: "package-group"
---

# packages/video

[English](README.md) | 中文

## 概述

video 包组拥有按 Session 隔离的制作项目，连接可复用参考素材、可编辑镜头、生成提供方与按顺序排列的整片导出。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [video-production](video-production/README.zh.md) | 项目服务、持久项目提供方、模型工具与 Remote 操作 | `ctx.videoProduction` |
| [video-comfyui](video-comfyui/README.zh.md) | 使用运维配置的 ComfyUI 工作流的可选 HTTP 生成提供方 | 向 `ctx.videoProduction` 贡献能力 |
| [video-comfyui-runtime](video-comfyui-runtime/README.zh.md) | 本地环境准备及自有进程托管 | 向 `ctx.capabilities` 贡献能力 |

<a id="related-documentation"></a>
## 相关文档

- [视频制作子系统](../../docs/subsystems/video-production.zh.md) 拥有项目数据与操作语义。
- [视频工作台](../client/ui-video-production/README.zh.md) 拥有画布交互与媒体呈现。

<a id="dev-note"></a>
## 开发备注

无。
