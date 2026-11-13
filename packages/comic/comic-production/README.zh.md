---
description: "在宿主保存可编辑漫画项目、原尺寸 PNG 图层和可移植项目包。"
kind: "package-reference"
---

# @deepseek-ai/dsh-comic-production

[English](README.md) | 中文

## 概述

把漫画项目保存在工作区，在同一工作区的另一个会话中继续编辑。项目保留页面排版、画格顺序、可编辑对白和原画修订。项目包携带这些记录和图像数据，可在另一个工作区打开并继续编辑。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 Web profile 中同时启用宿主服务和[漫画制作视图](../../client/ui-comic-production/README.zh.md)。选择工作区里的会话，即可创建或打开项目。导入项目包会在所选工作区创建一份可独立编辑的项目。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

宿主先检查会话的工作区归属，再开放项目和图像数据。编辑提交时会核对已保存的修订号。浏览器通过生成的 Remote 接口读取项目，保留本地更改直到宿主接受提交。

项目将原始 PNG 字节与可编辑的页面几何和对白分开保存。新增图层修订后仍可取用旧稿。项目包包含重新打开项目所需的图像数据，可脱离原宿主使用。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无。服务向 Web 编辑器提供项目操作。

#### KV Cache 影响

项目和原画编辑不会改变模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 原画图层使用 PNG 交换。绘画软件原生文档、自动生图和印刷制作由独立能力提供。
- 同时编辑时按当前已保存的修订号处理冲突。宿主不会合并重叠编辑。

<a id="dev-note"></a>
### 开发备注

无。
