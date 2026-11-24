---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-24-rea-selection

[English](2026-11-24-rea-selection.md) | 中文

## 概述

为选择启用 REA 的新建 Web 会话记录所选启动配置。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-24-rea-selection
baseline: false
changes:
  - root: "event:rea-experiment/selected"
    previous: null
    after: "b7db016f7c5cc71d209273d9042d1a79ada5fcf2fa20cfec95d5980546605d06"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

没有选择记录的会话沿用原行为。新版读取器在恢复或分叉已启用会话时保留所选启动配置。缺少 REA 支持的 v4 读取器会在恢复或修改会话前拒绝未知的必需事件。该事件不使用 ignorable 标记，因为跳过事件会改变回放时可用的工具。写入版本保持 v4。

<a id="verification"></a>
## 验证

当前 REA 和视频工具夹具通过 20 项测试。上一构建通过 21 项存储约定和当前事件接纳测试，其中包括在接纳前拒绝未知必需事件。

<a id="dev-note"></a>
## 开发备注

无。
