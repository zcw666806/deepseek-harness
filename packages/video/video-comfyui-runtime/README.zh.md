---
description: "通过 DSH 能力中心使用已核验离线产物和本机绑定，准备并托管本地 ComfyUI。"
kind: "package-reference"
---

# @deepseek-ai/dsh-video-comfyui-runtime

[English](README.md) | 中文

## 概述

本可选提供方让本地 ComfyUI 运行环境可由 `ctx.capabilities` 管理。加载时注册检查、启动和停止操作；配置产物缓存后还可准备环境。注册不会启动引擎。[工作流提供方](../video-comfyui/README.zh.md)可以在生成前请求此运行环境，让 DSH 工作台成为用户入口。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 `capability-manager`、本地文件系统及受管理子进程提供方旁挂载本包。能力标识为 `engine.comfyui`。默认运行目录是 `DSH_HOME/runtimes/comfyui`，显式相对路径按启动目录解析。每台机器绑定基础 Python 程序、运行目录、离线缓存目录和清单摘要。这些绑定不随项目包迁移。

```yaml
- id: video-comfyui-runtime
  name: '@deepseek-ai/dsh-video-comfyui-runtime'
  config:
    directory: .tools/comfyui/0.43.0-cpu
    pythonPath: python
    port: 8188
```

准备环境需要 `artifactDirectory`、`manifestName` 和 `manifestSha256`。缓存包含由哈希绑定的清单、`source.zip`、`requirements.lock.txt` 及 `wheels/`。安装器在写入新环境前验证源码归档、每个 wheel 及完整版本与哈希锁。它创建私有虚拟环境，并按哈希离线安装 wheel，不让包解析器下载代码。已有完整安装会按源码和已安装 wheel 字节核验。缺少完整安装标记的目标会保留以供检查，不会被覆盖。

启动先验证已准备环境，使用 CPU 模式，仅绑定本机 `127.0.0.1` 的指定端口，禁用外部自定义节点和在线合作节点，并使用已安装前端。数据和缓存位于运行目录下。子进程环境移除继承的应用凭据和 Python 搜索路径。每次启动使用私有字节码位置，并禁止写入字节码。

已就绪的本地 ComfyUI 可以直接连接，但不会接管其进程。DSH 仅能停止本注册启动的进程树。启动取消、显式停止及插件卸载均等待自有进程树退出，再删除私有启动数据。关闭 DSH 不会停止仅连接的外部服务。

生成的[配置目录](../../../docs/config-catalog.zh.md)拥有默认值及字段边界。就绪检查验证预期 ComfyUI 版本，并限制每次响应大小。工作流节点与模型的前置条件由独立工作流提供方负责，因此引擎运行不代表已经安装 AI 视频模型。

<a id="understand-the-implementation"></a>
## 理解实现

`ManagedComfyRuntime` 向既有能力目录贡献回调，并通过配置的子进程服务启动进程。进程提供方拥有 Windows 子孙进程和管道结束处理；本提供方拥有句柄及私有启动目录。基础 Python 助手在隔离模式、不初始化 site 的情况下检查已批准产物，再允许候选库加载。它不把产物清单中的宿主路径作为部署指令。

能力导出仅包含此引擎标识和版本。恢复时报告目标是否有匹配的已安装提供方；不会复制虚拟环境、安装 Python 或启动引擎。本机绑定及已审查产物标识仍属于目标机器配置。

<a id="further-exploration"></a>
## 进一步探索

- [能力管理器](../../capability/capability-manager/README.zh.md)拥有操作接纳和可迁移配置。
- [ComfyUI 工作流](../video-comfyui/README.zh.md)拥有生成输入、任务取消及视频输出选择。
- [视频制作](../video-production/README.zh.md)拥有项目包和成片导出。
- [子进程服务](../../subprocess/subprocess/README.zh.md)拥有进程树终止。

## 模型体验

<a id="model-experience"></a>

### 托管执行前置条件

#### 模型看到什么

本提供方不贡献工具或系统提示词。既有 [`video_project` 工具](../../../docs/tool-catalog.zh.md#deepseek-aidsh-video-production)可以通过工作流提供方间接调用指定运行环境。运行参数、环境路径和产物文件不会出现在项目工具结果中。

#### Token 影响

注册不增加模型请求前缀。只有普通的已记录工具结果会将生成或运行环境失败引入对话。

#### KV Cache 影响

环境准备及启动、停止不改写对话历史。既有工具结果正常追加，缓存行为仍由调用模型提供方决定。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **准备助手面向已审查的 Windows CPU 产物**——要求匹配的基础 Python 版本和引导包哈希。其他硬件或系统需要对应的已审查产物及准备提供方。
- **缓存和基础 Python 必须已经可用**——不执行联网下载、驱动安装、模型下载或自定义节点安装。
- **运行目录中的虚拟环境不能直接迁移**——目标机器从已审查产物缓存重建；项目包独立携带数据和能力需求。
- **所有权属于当前 DSH 进程**——正常卸载等待子孙进程退出，强制终止宿主可能需要外部清理；不会自动结束未知监听进程。
- **失败的部分准备会保留**——在用干净目录重试前检查原目录。导入项目不能指定或删除该目标。

<a id="dev-note"></a>
### 开发备注

无。
