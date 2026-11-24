# Agent Note: 为源自 qywork 的能力复用 Harness 服务

Status: implemented

[English](2026-10-19-qywork-capability-adoption.md) | 中文

## 问题

Qywork 同时包含值得采用的能力和 Harness 已有的功能。导入其应用会重复执行、存储、权限和呈现职责。参考来源为干净的 [qywork 修订 bd11cbe74d56a2031f9c5476de79d64d46ea410a](https://github.com/qingxueyanshang/qywork-qingyan-harness/tree/bd11cbe74d56a2031f9c5476de79d64d46ea410a)；采用的行为由现有 Harness 包负责。

## 决策

**按需读取 MCP 资源。** 当服务端声明资源能力时，`dsh-mcp-client` 暴露带服务端命名空间的列表和读取操作，也支持不提供工具的服务端。列表返回一页及其不透明续页游标；读取返回有序文本和资源标识。二进制 blob 返回省略提示，不将 base64 保留在规范结果或模型历史中。调用复用现有 SDK、工具策略、取消、超时和连接生命周期。资源不会预先注入上下文。资源模板和提示词仍不支持。参考来源是 [qywork 资源消费](https://github.com/qingxueyanshang/qywork-qingyan-harness/blob/bd11cbe74d56a2031f9c5476de79d64d46ea410a/packages/mcp/src/resources.ts)。

**通过 jobs 运行后台工作流。** `workflow` 接受 `run_in_background`；已接纳的工作返回任务 id，并独立于发起工具的取消信号继续执行。现有任务通知、`job_output` 和 `job_kill` 负责观察、收集和取消。后台运行不追加前台 `tool-workflow/*` 时间线：该时间线对步骤结束的解释会将仍在运行的工作显示为中断。前台记录继续可用。任务仅存在于当前进程，不承诺日志恢复或进程重启后的续跑。Qywork 的[编排器](https://github.com/qingxueyanshang/qywork-qingyan-harness/blob/bd11cbe74d56a2031f9c5476de79d64d46ea410a/packages/team/src/orchestrator.ts)提供比较证据，不替换执行引擎。

**保留本地文件未命中部分的换行。** `dsh-fs-local` 在 LF 归一化文本中执行字面量匹配，并将命中范围映射回原文件。只有替换范围发生改变；替换文本中的换行采用文件的主导风格，数量相同时采用 LF。差异文本继续归一化。现有锁、观察与版本检查、原子写入及字面量歧义错误继续由原有实现负责。这采用了 [qywork 编辑 · tools/src/files.ts](https://github.com/qingxueyanshang/qywork-qingyan-harness/tree/bd11cbe74d56a2031f9c5476de79d64d46ea410a)展示的行为，不导入其文件系统实现。

## 比较

| 领域 | Harness 已有能力 | 本次采用或保留的差异 |
|---|---|---|
| 模型、上下文、技能 | 多提供方路由、压缩、溢出存储、会话检索、分层技能目录 | 保留；这些不是本次新导入的功能。 |
| MCP 资源 | SDK 连接、远程工具、重连 | 选中列表与读取；不包含模板、提示词及二进制投递。 |
| 工作流执行 | 脚本编排、可续接子任务、jobs | 选中后台执行；持久化审查与检查点图仍是独立能力。 |
| 本地编辑 | 字面量编辑、过期保护、原子写入 | 选中混合 LF/CRLF 保留。 |
| 长期记忆 | AGENTS 指令及[外部记忆 MCP 示例](../../../../docs/user/guide/mcp-memory.zh.md) | 内置项目与全局记忆 CRUD 及管理入口仍有差距；见 [qywork 记忆 · tools/src/memory.ts](https://github.com/qingxueyanshang/qywork-qingyan-harness/tree/bd11cbe74d56a2031f9c5476de79d64d46ea410a)。 |
| 技能导入 | 文件系统发现及按需加载 | 目录与 ZIP 的事务导入仍是独立事项；见 [qywork 安装器 · tools/src/skills/install.ts](https://github.com/qingxueyanshang/qywork-qingyan-harness/tree/bd11cbe74d56a2031f9c5476de79d64d46ea410a)。 |
| 日历定时任务 | 同会话的持久化单次及固定间隔提醒 | 每日历法规则及项目调度存在差异；见 [qywork 定时任务](https://github.com/qingxueyanshang/qywork-qingyan-harness/blob/bd11cbe74d56a2031f9c5476de79d64d46ea410a/packages/core/src/domain/schedule.ts)。 |
| 外部 CLI 续接 | ACP 委派及进程内续接 | 厂商 CLI 会话 id 续跑仍是独立事项；见 [qywork 后端](https://github.com/qingxueyanshang/qywork-qingyan-harness/blob/bd11cbe74d56a2031f9c5476de79d64d46ea410a/packages/team/src/cli-backend.ts)。 |
| 工作台 | ZIP 导出、插件设置、确定性技能加载、[产出引用](../../../../packages/client/ui-deliverables/README.zh.md) | [内联媒体预览](https://github.com/qingxueyanshang/qywork-qingyan-harness/blob/bd11cbe74d56a2031f9c5476de79d64d46ea410a/apps/web/src/components/FileView.tsx)、懒加载文件树编辑及专用导入页仍是独立差异。 |
| 桌面浏览器、原生自动化、Office | 通用子进程与 MCP 接入 | CDP 与原生控制及 [Office 工具 · tools/src/office.ts](https://github.com/qingxueyanshang/qywork-qingyan-harness/tree/bd11cbe74d56a2031f9c5476de79d64d46ea410a)需要专用服务、配置、权限和测试；本次未采用。 |

## 考虑过的替代方案

**复制应用或创建平行服务。** 不采用，因为 Bun/Tauri 集成、存储表和厂商适配器会引入相互竞争的生命周期与权威来源。

**导入所有已识别差异。** 不采用，因为日历规则、托管记忆、包安装、持久化审查及宿主自动化需要分别确定职责和权限。Unicode 感知估算也必须尊重[回放 token 计量决策](../../../../packages/llm/token-meter/README.zh.md)；提供方 usage 锚点已经缓解历史内容的估算误差。

**扩展后台运行的工作流时间线。** 本次范围不采用：现有 jobs 已能提供控制和完成通知，无须改变持久化工作流及 UI 协议。

## 影响

三项有明确范围的能力复用既有服务。后台工作流采用现有任务控制，代价是不提供专用成员时间线及重启恢复。二进制资源明确无法通过这些操作读取。[MCP 客户端](../../../../packages/mcp/mcp-client/README.zh.md)、[动态工作流](../../../../packages/workflow/README.zh.md)和[文件系统工具 schema](../../../../packages/fs/tool-fs/README.zh.md)继续分别拥有传输、脚本和观察规则的部分职责；没有任何一份被完全取代或归档。

## 验证

覆盖种类包括仅资源服务端的 Loader 组合与卸载、分页、文本顺序、二进制省略、非法响应、策略拒绝和取消；后台接纳、结果、取消、所有者卸载及清理失败；混合换行、跨行与重复匹配、元字符、单独回车和大型搜索片段。录制会话快照为模型可见的工具变更提供证据。
