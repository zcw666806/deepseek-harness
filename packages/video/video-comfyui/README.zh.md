---
description: "通过管理员自有 API 工作流、受限媒体传输和按任务取消接入可选 ComfyUI HTTP 视频生成服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-video-comfyui

[English](README.md) | 中文

## 概述

这个可选提供方将现有 ComfyUI 服务连接到 `ctx.videoProduction`。管理员提供服务端点、导出的 API 格式工作流、明确的输入绑定和一个视频输出位置。适配器上传项目中已准入的参考图，只提交一次任务，等待自身任务的历史记录，再通过现有附件服务保存选定的 MP4 或 WebM。它不会安装 ComfyUI 代码、自定义节点、模型或 GPU 运行环境。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

通过 `dsh` profile 将提供方与 `video-production`、`attachments` 一起挂载。默认 `enabled: false`；加载或列出目标均不产生网络请求。仅在管理员已配置好服务的工作流依赖及授权后启用。协议审查固定于 [ComfyUI v0.43.0，提交 426f5eea52a7ece1dd599fff4cb6cd1f352ddd24](https://github.com/Comfy-Org/ComfyUI/tree/426f5eea52a7ece1dd599fff4cb6cd1f352ddd24)。

```yaml
- id: video-comfyui
  name: '@deepseek-ai/dsh-video-comfyui'
  config:
    enabled: false
```

启用时必须提供 `baseURL` 和非空的 `workflows` 数组。`baseURL` 接受 HTTP 或 HTTPS，可带路径前缀，但不能包含内嵌凭据、查询或片段。可选 `headers` 只发送到这个配置的源站；所有重定向均被拒绝。不要将认证值提交到配置仓库。`Host`、`Content-Type`、`Content-Length` 等由传输层管理的请求头不能覆盖。

### 工作流配置

可选的 `video-comfyui` 设置命名空间跟随当前运维配置，无需重启 DSH。每次生成捕获一个已验证快照。禁用工作流会注销生成器并取消其进行中尝试；插件卸载等待工作完成。配置 `managedCapability` 后，生成会在提交任务前启动或连接指定的 DSH 托管运行环境。

挂载持久设置后，`videoWorkflows` 提供带修订号的服务地址及 API 工作流编辑器。读取会清空操作输入和元数据，并拒绝含凭据或机器绝对路径的模板；请求头值不会通过此编辑器返回。验证检查端点和映射，不联系 ComfyUI。保存保留宿主请求头及运行环境绑定，拒绝过期修订，并禁用生成，直到显式启用。启用工作流只注册目标，不启动引擎。内置黑帧诊断模板用于检查媒体传输，不生成 AI 内容，也不需要模型权重。

能力中心通过独立于引擎进程的 `video.comfyui` 管理工作流配置。启用时，检查会核对已配置节点类型和枚举模型输入。导出配置会清空操作相关输入，并排除端点请求头和机器绑定。导出和恢复均拒绝凭据输入字段，包括令牌名称，不受值的 JSON 类型影响；生成令牌上限和令牌数组仍可迁移。恢复先验证工作流数据，再以禁用状态持久保存，保留目标端点、凭据及运行环境绑定。显式启用后，工作流才会出现在生成目标目录中。

每个工作流包含唯一 `id`、显示用 `title` 和 `template`，后者是 ComfyUI 导出的 API 格式节点字典。每个节点含有 `class_type` 和 `inputs`；前端画布图 JSON 会被拒绝。模板由管理员持有：模型不能提供节点、更改绑定、选择 URL 或替换工作流。以下字段以 `{node, input}` 选择已有标量输入：

| 字段 | 含义 |
|---|---|
| `prompt` | 接收镜头提示词的字符串输入。 |
| `duration` | 数值输入，使用 `unit: seconds`，或使用 `unit: frames` 并明确提供正数 `fps`；帧数等于秒数 × fps + `frameOffset`，后者默认为 0。秒数绑定禁止帧参数。 |
| `width`、`height` | 接收所选精确尺寸组合的数值输入。 |
| `references` | 按顺序接收已上传图片路径的字符串输入；请求必须提供恰好相同数量的参考图。空数组声明文生视频工作流。 |
| `outputPrefix` | 必填的保存节点字符串输入，接收 `dsh/<操作 UUID>/video`；选中的输出必须位于本次操作目录内。 |

绑定必须互不重复并指向已有标量，不能是节点连线输入或任意属性表达式。`durations` 声明 1 至 15 范围内不重复的整数秒数。帧数换算必须让每个已声明时长都产生正整数帧。`sizes` 声明不重复的 `{aspectRatio, resolution, width, height}` 条目，其中尺寸为 1 至 16,384 的整数。目标目录分别公开画幅和分辨率列表；适配器还会在上传前校验两者是否为配置中的精确组合。

`output: {node, key, index}` 从自身成功任务的原始历史中选定一个数组元素。已审查的原生 `SaveVideo` 节点使用 `key: images`；自定义保存节点可以明确配置其他键。该元素必须以 MP4 或 WebM 普通文件名、`type: output` 以及操作目录内的安全相对子目录描述文件。适配器不会选择其他节点输出、任意 URL、input/temp 文件、带类型注记的路径或基于哈希的 `/view` 引用。

提供方注册生成器 `comfyui`，每个工作流的 `id` 作为可选模型。每个目标携带序列化工作流配置的 SHA-256 修订值、时长、已声明尺寸和精确参考图数量。现有项目服务将该修订值固定到生成尝试。端点请求头的变更不会将请求头暴露到目标元数据。

### 传输限制

所有限制在注册前校验。`timeoutMs` 限制上传、提交、轮询、下载及附件保存，总计默认 300,000 毫秒。`cleanupTimeoutMs` 提供独立的取消预算，默认 10,000 毫秒。`pollIntervalMs` 默认为 1,000 毫秒。这些整数时长接受 1 至 2,147,483,647 毫秒。`maxJsonBytes` 默认 1,048,576 字节，接受 1 至 16,777,216，限制每次 JSON 请求、响应和序列化工作流。`maxUploadBytes` 限制参考图编码字节总量，默认 20,971,520；`maxVideoBytes` 限制下载视频字节，默认 536,870,912。后两者均接受 1 至 2,147,483,647 的整数。[配置目录](../../../docs/config-catalog.zh.md)列出全部字段。

<a id="understand-the-implementation"></a>
## 理解实现

适配器在唯一一次 `POST /prompt` 提交前分配随机任务和客户端 UUID。参考图按顺序通过 `/upload/image` 上传到私有 input 子目录，并指定 `overwrite: false`。轮询只读取 `/history/<自身任务 UUID>`，同时验证存储的任务及客户端身份。成功终态确认后才选择输出并通过 `/view` 下载。JSON 和二进制响应受流式字节限制，重定向被拒绝，且输出字节必须符合 MP4 或 WebM 才会由附件存储发布引用。

取消只使用 `POST /api/jobs/<自身任务 UUID>/cancel` 和 `/api/jobs/<自身任务 UUID>`。在已审查的服务端版本中，队列在同一个互斥锁内核对当前任务身份并发出中断，防止已完成任务的取消误伤后继任务。仅发出取消请求不代表任务已经停止；必须观察到自身任务终态，或已确认提交、已出队的任务不存在。适配器从不调用旧版 `/interrupt`，也不清空队列、删除全局历史或重试任务提交。

用户取消时，尚未完成的提交可以在独立清理预算内返回确认。如果响应丢失，清理只检查预分配的任务身份。预算耗尽时，服务仍可能在验证尚未确认的提交；此时诊断明确说明远程终止尚未确认。卸载会注销目标、中止本地尝试，并等待受预算限制的清理完成。任务及客户端 UUID 用于标识请求，不用于用户认证，也不提供服务端租户隔离。

<a id="further-exploration"></a>
## 延伸阅读

- [视频生产](../video-production/README.zh.md)负责持久生成尝试、目标选择和成片导出。
- [附件](../../attachment/attachment/README.zh.md)负责已准入图片读取及视频持久化。
- [官方服务端路由](https://docs.comfy.org/development/comfyui-server/comms_routes)说明本地 API。
- [已审查的原子任务取消](https://github.com/Comfy-Org/ComfyUI/blob/426f5eea52a7ece1dd599fff4cb6cd1f352ddd24/server.py#L1036)与[队列实现](https://github.com/Comfy-Org/ComfyUI/blob/426f5eea52a7ece1dd599fff4cb6cd1f352ddd24/execution.py#L1378)确定受支持的取消语义。

<a id="model-experience"></a>
## 模型体验

### 已配置的生成目标

#### 模型看到什么

该提供方不增加工具或系统提示词。现有 `video_project` 工具可明确选择生成器 `comfyui` 和管理员配置的工作流身份。项目结果包含普通尝试元数据和持久视频引用；工作流内容、请求头、远程媒体路径及视频字节不会进入这些结果。

#### Token 影响

提供方不增加请求前缀 token。记录的项目结果包含所选生成器、工作流身份、配置修订值和结果，受 `video-production` 的项目限制约束。

#### KV Cache 影响

提供方注册不改写会话历史或稳定的项目工具 schema。每次完成的工具调用追加普通结果；缓存行为由调用模型的提供方负责。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **需要现有且获准使用的服务和可运行工作流**——此包不安装 ComfyUI，也不发现、安装或验证节点及模型的运行时可用性。工作流本身可能调用外部或付费服务；管理员负责这些选择。
- **取消依赖已审查的原子 jobs API**——缺少该接口的旧服务返回明确的终止未确认错误。不会降级到不安全的全局中断；不响应取消的节点可能超过清理期限。
- **服务端点由可信管理员管理**——任务 UUID 核对防止意外选择其他任务；认证及多用户隔离仍由管理员负责。
- **远程文件保留在 ComfyUI 服务上**——适配器不删除已上传参考图和生成输出；管理员管理留存。适配器不暴露任意文件删除接口。
- **进度使用自身任务历史轮询**——不提供 WebSocket 节点进度、预览流、自动重启恢复、工作流编辑、视频输入编辑或续写。
- **仅支持标量绑定、固定数量参考图及 MP4/WebM 输出**——工作流专有集合、超出明确偏移量的帧数量化和其他媒体格式需要明确的集成变更。
- **默认协议测试使用本地 HTTP 测试服务**——显式启用的 [Web 诊断](../../../apps/web/tests/video-comfyui.e2e.ts)使用原生黑帧验证现有本机 ComfyUI 服务、项目持久化和真实 FFmpeg 导出。它要求明确的端点与渲染器路径，不验证 AI 画质或推理速度。

<a id="dev-note"></a>
### 开发备注

无。
