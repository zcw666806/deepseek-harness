---
description: "面向模型的 workflow 工具：运行扇出 subagent 的 JavaScript 编排脚本，供选择或配置模型驱动编排的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-workflow

[English](README.md) | 中文

## 概述

`dsh-tool-workflow` 让模型通过 JavaScript 脚本协调多个 subagent，并收集最终 JSON 值。前台调用等待完成；`run_in_background: true` 返回任务 id，让父级继续其他工作。后台调用需要任务服务与任务控制工具。仅当用户明确要求工作流式或大型多 agent 编排时选择它；一两项委派时优先使用普通 subagent 调用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`workflow` 工具运行由模型编写的编排脚本，把工作扇出到多个 subagent，并返回脚本的最终 JSON 值。仅当用户明确要求工作流或大型多 agent 编排时使用——例如跨多个文件的审计、一次迁移、多角度研究；一两项委派时优先使用普通 subagent 调用。

### 调用工具

模型提交 `meta`（必需的身份数据：`name`、`description`，以及可选的 `whenToUse` 与 `phases`）、`script`（必需的纯 JavaScript 脚本体——不含 `export const meta` 语句；工具描述携带完整的编写约定）、可选 `args`（作为脚本全局变量 `args` 的 JSON 对象）与可选 `run_in_background`。裸列表应包装到 `args` 的字段中。

前台成功返回 `{ runId, agentsStarted, result }`，渲染为 `workflow "<name>" completed (<count> agent<optional-s>).`，后接 `Return value:` 与美化打印的 JSON。后台成功立即返回 `{ jobId }`；`job_output` 收集最终结果，`job_kill` 停止工作流，已配置的任务通知策略投递尚未报告的完成结果。脚本解析或 meta 校验失败会返回错误，不注册任务。执行失败与取消会报告原因；部分输出绝不会被报告为成功。

### 运行期间的预期

前台调用等待完成，并把父级步骤的中止信号桥接到工作流。后台调用把所有权交给父 Agent 的任务注册表：发起步骤结束后任务继续运行，`job_kill`、Agent 释放或任务服务释放会取消它。每次结算都先等待工作流释放，再让任务报告终态。模型收到最终结果，不接收中间子 agent 消息。后台任务只保存在当前进程内，进程退出后不能恢复。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `toolName` | `workflow` | 要注册的面向模型工具名称。 |
| `maxResultChars` | `50000` | 渲染结果上限；更长的 JSON 会被截断并附上提示。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-workflow)是每个受支持字段的穷尽式真源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释消费方如何与引擎拆分、运行生命周期与记录如何工作；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

消费方拥有模型侧 schema、`tool:<toolName>` 系统提示词指导与结果包络；脚本解析、执行、上限与取消位于 `ctx.workflowEngine` 之后，因此更坚固的引擎可以无缝替换，而不改变模型看到的内容。使用指导以提示词段的形式随工具插件交付，绝不放入部署 persona。

### 运行生命周期

前台执行在 `try/finally` 内等待 `run.result`，并把 `exec.signal` 桥接到 `run.cancel()`。后台执行只在 `ctx.jobs.start()` 接纳所有者并确认控制器可用后启动；缺少服务或控制器时，在工作流启动前拒绝。生产者负责运行的取消与清理，任务结果包含有长度上限的最终文本。两条路径都先释放运行，再报告结算。清理失败会让任务失败，并使持久工作流记录保留缺少终态后缀的前缀。

### 持久会话记录

对于前台根 transport 执行（`exec.parent` 缺省），工具会用四个 log-only 事件把运行投影到调用 Agent 的 Session：`start()` 返回后写 run-start，只记录 `run.id` 匹配的成员开始与结束，并且只在结果可用且释放完全停稳后写 run-end。后台调用使用现有任务控制与通知，不创建前台工作流 Chat 记录。嵌套 transport 调用不写工作流记录。首次追加失败会停止后续记录，留下合法连续前缀，不改变执行或清理。不变式拒绝重复 start、未配对成员、仍有开放成员的终点与 run-end 后更新，并允许缺失终态后缀。

### 渲染意图

按[渲染意图 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-02-tool-render-intent-union.zh.md)预先确定：使用 `generic` 卡片，标题为 `workflow: <meta.name>`，直接从 `args.meta.name` 读取——呈现是参数的纯函数——脚本文本作为 `rawInput` 携带。结果继续使用 generic 卡片。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：工具注册、运行生命周期、记录器接线 |
| [`src/types.ts`](src/types.ts) | 四个 log-only 记录事件 payload 及其 `SessionEventMap` 声明 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件：持久工作流记录协议校验 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当工具级契约不够用时阅读以下页面。它们从共享工作流模型逐步进入引擎与可比的委派工具。

- [工作流子系统](../../../docs/subsystems/workflow.zh.md)——seam 契约、启动请求与事件载荷。
- [工作流 seam](../workflow/README.zh.md)——工具背后的运行与结果词汇。
- [worker-thread 引擎](../workflow-worker-thread/README.zh.md)——执行脚本的引擎。
- [subagent 工具](../../subagent/tool-subagent/README.zh.md)——一两项委派时的普通委派替代方案。
- [组地图](../README.zh.md)——工作流能力家族及其包。
- [动态工作流 Agent Note](../../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.zh.md)——seam 设计及其决策。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

在该插件的注册作用域内，每个父级请求都会收到下方的工作流指导。作用域工具限制可以隐藏 schema，而不移除这段独立注册的指导。

##### 工作流指导

```markdown
Use the <toolName> tool ONLY when the user explicitly asks for a workflow or for large multi-agent orchestration: you write a JavaScript script (the tool description documents the exact format) that fans work out across many subagents with phases and structured results. For one or two delegations, prefer plain subagent calls.
```

#### Token 影响

插件启用期间，每个请求都会产生少量固定的指导 token 开销。

#### KV Cache 影响

只要插件作用域与指导文本不变，前缀就保持稳定。启用或 dispose（资源释放）可能会使从该提示词段起的缓存复用失效。

### 工具 schema

#### 模型看到什么

工具可见时，已生成的默认 [`workflow` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-workflow) 包含完整的 JavaScript 钩子与元数据约定；`toolName` 可以重命名该定义，模型会提交脚本、元数据与可选 args。

#### Token 影响

工具可见时，每个请求都会产生较大的固定 schema token 开销。

#### KV Cache 影响

只要 `toolName`、定义与可见性不变，前缀就保持稳定。重命名、插件生命周期或作用域限制可能会使从该 schema 起的缓存复用失效。

### 工具调用历史与结果

#### 模型看到什么

完整的模型脚本、元数据与 args 留在 assistant 工具调用中。前台成功文本严格为 `workflow "<name>" completed (<count> agent<optional-s>).`、换行、`Return value:`、换行，以及美化打印的数据相关 JSON；达到上限时另起一行加入 `… [truncated: <omitted> more characters]`。后台启动文本严格为 `workflow "<name>" started in background (job_id: <jobId>). Use job_output to collect the result or job_kill to stop it.` 任务最终文本使用相同的完成渲染，或报告 `workflow run was cancelled`（可追加 ` (<error>)`）、`workflow run failed: <error-or-unknown error>`。前台失败使用普通 `Error:` 前缀。中间子 agent 消息被省略；任务读取与通知遵循[任务控制工具](../../jobs/tool-jobs/README.zh.md)。

#### Token 影响

调用 token 可能很多，并会保留到压缩（compaction）为止。结果渲染受 `maxResultChars` 限制；子模型 token 与父级保留的上下文相互独立。

#### KV Cache 影响

仅追加；新增可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明该工具尚未支持什么。它们是当前约束，不是任务积压。

- **后台任务需要运行中的进程与控制器**——已接纳的任务在发起工具步骤结束后继续运行，但 Agent 或任务服务释放会取消它们。进程退出后，任务 id 不能恢复工作流。
- **`args` 必须是对象，Native 结果文本有界**——调用方把顶层数组／标量包装到字段中；规范工作流结果保持完整，超过 `maxResultChars` 的 JSON 会在面向模型的投影中截断，而不是存储在检索句柄背后。
- **每次工具注册的工作流策略固定**——提供方选择、上限与工具名称属于部署配置，不是模型调用参数。
- **后台进度与结果由任务控制提供**——后台调用不创建专用工作流时间线。前台时间线覆盖顶层调用；嵌套 PTC 调用没有独立时间线。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：尚未决定的开放方向。它明确不具权威性——已交付的行为、限制与既定理由以上文、包代码与相关 Agent Note 为准。

开放方向：把截断的 JSON 存储在检索句柄背后，而不是剪裁投影；记录超出顶层的嵌套 dispatch。

</details>
