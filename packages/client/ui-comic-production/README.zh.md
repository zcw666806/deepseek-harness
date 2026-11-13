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

用 [Web profile 补丁](../../bundle/web-app/comic-production.patch.yml)启用漫画制作包。打开目标工作区内的会话，选择**漫画制作**。创建漫画，或打开该工作区已保存的项目。离开项目前保存修改。

选中页面和画格后编辑版式和对白。选中原画图层并导入 PNG。要修订图层，先导出原始 PNG，在绘画应用中编辑，再把相同尺寸的 PNG 导回同一图层。如需继续使用绘画应用的原生编辑功能，把可编辑源文件和项目一起保存。

用阅读预览检查页序和对白。导出 PNG 以分享一页，或导出项目包以转移可编辑页面与原画。从项目列表导入项目包会创建一份可独立编辑的副本。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

会话视图挂载漫画制作 Remote，向宿主提交带修订号的编辑请求。页面排版、原画选择和对白使用独立于预览缩放的项目坐标。PNG 渲染器先读取已采用的图层修订，再合成原画和对白。

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
- 原画修订以 PNG 文件导入。使用绘画应用创作和精细修笔。

<a id="dev-note"></a>
### 开发备注

无。
