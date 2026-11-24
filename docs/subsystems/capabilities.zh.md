# 能力管理

[English](capabilities.md) | 中文

[capability-manager](../../packages/capability/capability-manager/README.zh.md)拥有一个由 effect 管理的已安装提供方目录。提供方贡献描述、实测前置条件，以及固定的检查、准备、启动和停止回调。[管理界面](../../packages/client/ui-capabilities/README.zh.md)消费同一组 Remote 操作。注册提供方不会启动引擎。

## 运行时所有权

能力管理器在配置的截止时间内为每个提供方串行执行管理操作。移除时停止接纳、取消排队和进行中的工作，并等待完成。同一标识的替代注册不能继承已移除提供方的操作。本地进程所有权属于启动该进程树的提供方；可以连接已运行的外部服务，而不接管或终止它。

[ComfyUI 运行环境提供方](../../packages/video/video-comfyui-runtime/README.zh.md)将机器路径和已核验离线产物与可迁移的工作流设置分离。它使用已配置的子进程及文件系统服务、本地就绪检查、私有运行数据，以及等待完成的清理。[ComfyUI 工作流提供方](../../packages/video/video-comfyui/README.zh.md)可以在生成前启动指定的运行环境能力；其他生成提供方可以使用同一个项目服务而不依赖该引擎。

## 可迁移配置

`PortableCapabilityManifest` 记录提供方标识、引擎标识、可选引擎版本，以及拥有者明确导出的设置。它不携带可执行安装命令。提供方省略传输凭据和机器路径，并在提交设置前验证导入 JSON。缺少提供方、引擎或版本不同、拒绝设置和恢复成功分别报告。恢复配置不会准备或启动运行环境。

[视频项目包](../../packages/video/video-production/README.zh.md)额外迁移项目记录和去重媒体。恢复项目与应用其可选能力清单是明确的操作。环境目录及模型权重与项目媒体分开，便于目标机器重建匹配环境或绑定其他已配置引擎。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcapabilities--capabilitymanager"></a>

### `ctx.capabilities` — `CapabilityManager`

Capability directory shared by the Web management UI and installed engine providers.

```ts cordis-catalog
/**
 * Register an installed implementation; its callbacks retain process and credential ownership.
 * @param provider - Typed installed provider whose inspections contain only public diagnostics.
 * @returns Async disposer removing this registration, cancelling its operations, and awaiting settlement.
 */
register(provider: CapabilityProvider): () => Promise<void>

/**
 * Inspect every current installed capability without installing or starting it.
 * @param signal - Caller cancellation; each inspection also observes checkTimeoutMs.
 * @returns Current descriptions, actual callback-derived actions, and safe readiness observations.
 */
@Remote('list') async list(signal: AbortSignal): Promise<readonly CapabilityView[]>

/**
 * Execute one fixed operation through its current installed provider, serialized per capability.
 * @param id - Current registered capability identity.
 * @param action - Check, prepare, start, or stop; unsupported operations reject before provider invocation.
 * @param signal - Caller cancellation and configured complete-operation deadline.
 * @returns Post-operation inspection, or a safe error view when provider work fails.
 */
@Remote('perform') async perform(id: CapabilityId, action: CapabilityAction, signal: AbortSignal): Promise<CapabilityView>

/**
 * Export current engine requirements and provider-declared portable configuration.
 * @param signal - Caller cancellation; each provider read has the inspection deadline.
 * @returns A bounded manifest without runtime commands, environments, weights, or implicit credential copying.
 */
@Remote('exportManifest') async exportManifest(signal: AbortSignal): Promise<PortableCapabilityManifest>

/**
 * Preview installed engine compatibility and current prerequisites without changing target-machine state.
 * @param manifest - Complete untrusted portable manifest, validated before any provider inspection.
 * @param signal - Caller cancellation; each inspection includes its configured queue and execution deadline.
 * @returns Credential-free compatibility results; pending settings still require explicit provider validation during restoration.
 */
@Remote('planRestore') async planRestore(manifest: PortableCapabilityManifest, signal: AbortSignal): Promise<CapabilityRestorePlan>

/**
 * Restore matching installed providers' declarative settings; no runtime is installed or started.
 * @param manifest - Untrusted complete portable manifest; invalid or duplicate entries reject before any callback.
 * @param signal - Caller cancellation; each provider restore has the configured action deadline.
 * @returns Per-provider results. Missing engines and version mismatches remain explicit; independent restores can partially succeed.
 */
@Remote('restoreManifest') async restoreManifest(manifest: PortableCapabilityManifest, signal: AbortSignal): Promise<readonly CapabilityRestoreResult[]>
```

Source: [`packages/capability/capability-manager/src/index.ts`](../../packages/capability/capability-manager/src/index.ts)
<!-- END GENERATED cordis-surface -->
