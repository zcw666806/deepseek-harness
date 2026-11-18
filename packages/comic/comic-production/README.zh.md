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

在 Web profile 中设置 `comic-production.imageGeneration`，即可在完成的分镜下使用**生成四格图**。提供含 API 版本路径的 `baseURL`、`model` 和宿主凭据引用 `credentialRef`。服务调用兼容 OpenAI 的 `images/generations` 接口，请求一张 base64 图像。若提供方返回 URL，在 `imageOrigins` 中配置其确切的 HTTPS 来源。请求和可选的下载使用同一时限，默认 180 秒。

如需选择出图模型，在 `comic-production.imageGenerationTargets` 中为每条线路填写相同的连接字段，并设置唯一的 `id` 和用于显示的 `title`。`imageGeneration` 条目使用保留 ID `default`。配置多条线路时，在漫画创作中为每个会话选择出图模型。选择随会话保存，同时适用于自动出图和手动出图。只配置一条线路时可直接使用。如果所选线路已移除或凭据不可用，请另选模型。

在工作区会话中直接要求画一篇漫画，助手写好四格分镜后会自动出图。要先审阅分镜，在请求中说明即可，之后使用**生成四格图**。重新打开会话时会读取已保存的项目。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

宿主先检查会话的工作区归属，再开放项目和图像数据。编辑提交时会核对已保存的修订号。浏览器通过生成的 Remote 接口读取项目，保留本地更改直到宿主接受提交。

项目将原始 PNG 字节与可编辑的页面几何和对白分开保存。新增图层修订后仍可取用旧稿。项目包包含重新打开项目所需的图像数据，可脱离原宿主使用。

服务将返回的一张图裁成四个独立的 PNG 图层，按工作区、会话和原始消息保存一个项目。同一分镜的并发请求共用一次出图。刷新后仍可从原回复打开已保存的项目。提供方失败时保留分镜供重试。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

配置出图路线后，服务会在系统提示词中给出分镜格式。每轮成功结束时，宿主根据用户实际提出的请求和已保存的助手回复决定是否开始出图。

##### 分镜指引

```markdown
When the human directly requests a finished comic, default to four panels if no count is given. For a four-panel comic, plan it in the final reply. The application uses that reply to draw supported requests and shows the artwork when it is ready.
When the human asks to review or confirm a storyboard before drawing, present the storyboard and stop for their review. For instructions about making comics, answer the question normally.
For a storyboard, use a title on a separate line in 《Title》, then a brief art direction line with consistent characters. Give exactly four headings: Panel 1, Panel 2, Panel 3, Panel 4. Under each heading use Scene:, Action:, and Dialogue: on separate lines. In Chinese, use 第一格、第二格、第三格、第四格 and 画面：、动作：、对白：. Write each heading on its own line and use None or 无 for silence. End with the fourth panel and report only the planning you performed.
```

#### Token 影响

包含这一章节的每个请求都会产生固定的指引 token 开销。

#### KV Cache 影响

配置相同的各轮使用相同的指引。启用或停用该章节会改变从该位置起的前缀。

### 图像生成请求

#### 模型看到什么

配置的图像模型会收到分镜标题、画面描述、动作、画风和 `2×2` 布局指引。编辑器在返回的图像上独立排版对白。独占一行的 `storyboard.md` 链接保留在对话中。

#### Token 影响

图像请求包含固定的布局指引和发送给提供方的分镜字段文本。

#### KV Cache 影响

图像模型请求使用图像提供方自己的缓存机制。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 原画图层使用 PNG 交换。绘画软件原生文档和印刷制作由独立能力提供。
- 生成时一次请求绘制四格。要替换单格，可将 PNG 导入其原画图层。
- 同时编辑时按当前已保存的修订号处理冲突。宿主不会合并重叠编辑。

<a id="dev-note"></a>
### 开发备注

无。
