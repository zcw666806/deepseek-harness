---
description: "Web 漫画编辑器，支持多页分镜、可编辑对白、PNG 原画修订和阅读版导出。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-comic-production

[English](README.md) | 中文

## 概述

排布页面和画格、修订对白，并在保留气泡的情况下替换一格的原画。「漫画制作」通过[漫画制作服务](../../comic/comic-production/README.zh.md)保存可编辑项目。下载 PNG 阅读版，或下载项目包继续编辑。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

用 [Web profile 补丁](../../bundle/web-app/comic-production.patch.yml)启用漫画制作包。打开目标工作区内的会话，在输入框选择**漫画创作**。分别选择规划模型和图像生成模型，再发送创作需求。Agent 将分镜写入工作区的项目文档。通过**已有项目**或结果下的**打开编辑**可修订保存的稿件。

在对话里，找到包含四个编号画格的完整回复，点击下方的**导入四格分镜**。工作台会打开一页可编辑的稿件，保留画面、动作和对白。你可以在空图层里添加原画。

配置出图服务后，可以在同一条请求里要求四格漫画成品，分镜完成后会自动出图。如果你要求先看分镜，确认后可在回复下点击**生成四格图**。成品会保存在当前工作区，并显示在分镜回复下。点击**下载 PNG**可保存整页，点击**打开编辑**可修改原画和对白。重新打开会话后仍可查看已保存的漫画。

选中页面和画格后编辑版式和对白。选中原画图层并导入 PNG。要修订图层，先导出原始 PNG，在绘画应用中编辑，再把相同尺寸的 PNG 导回同一图层。如需继续使用绘画应用的原生编辑功能，把可编辑源文件和项目一起保存。

用阅读预览检查页序和对白。导出 PNG 以分享一页，或导出项目包以转移可编辑页面与原画。从项目列表导入项目包会创建一份可独立编辑的副本。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

漫画创作工作台挂载漫画制作 Remote，向宿主提交带修订号的编辑请求。页面排版、原画选择和对白使用独立于预览缩放的项目坐标。PNG 渲染器先读取已采用的图层修订，再合成原画和对白。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无。此视图通过浏览器编辑项目数据。

#### KV Cache 影响

打开、编辑或导出漫画不会改变模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 编辑器支持数字分页和横排文字。原生绘画文件交换与印刷制作由独立能力提供。
- 原画修订使用 PNG 文件。你可以导入自己的原画，或配置出图服务来生成原画。

<a id="dev-note"></a>
### 开发备注

无。
