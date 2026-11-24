/** Safe remote workflow editing over the provider's revisioned settings namespace. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { z } from 'zod'
import { resolveBaseURL, resolveConfig } from './config.ts'
import { exportWorkflows, restoreWorkflows } from './portable.ts'
import type { Config, WorkflowConfiguration, WorkflowConfigurationView } from './types.ts'
import { diagnosticTemplates } from './templates.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Revisioned workflow configuration without transport secrets. */
    videoWorkflows: VideoWorkflows
  }
}

const configurationSchema = z.object({ baseURL: z.string().optional(), workflows: z.array(z.unknown()) }).strict()
const revisionSchema = z.number().int().nonnegative()

function invalid(): never {
  throw new RemoteError('video-workflows/invalid', 'Check the service URL, API-format nodes, scalar bindings, durations and sizes. Remove credentials and absolute paths from workflow inputs.', { reason: 'configuration' })
}

/** Workflow editor; saving and enabling never contact or start the engine. */
export class VideoWorkflows extends TypertRemoteService {
  static inject = ['settings']

  /** @param ctx Owning provider context.
   * @param source Loader settings entry and validated configuration reader.
   */
  constructor(ctx: Context, private readonly source: { namespace: string; current: () => Config }) {
    super(ctx, 'videoWorkflows')
  }

  /**
   * Read a portable configuration and its optimistic write revision.
   * @returns Safe editable data; unsafe host templates fail without returning their values.
   */
  @Remote
  view(): Promise<WorkflowConfigurationView> {
    return Promise.resolve().then(() => {
      const { config, revision } = this.snapshot()
      try {
        const portable = exportWorkflows(config) as { workflows: unknown }
        const configuration = this.configuration({
          ...config.baseURL === undefined ? {} : { baseURL: config.baseURL },
          workflows: portable.workflows,
        }, config)
        return {
          revision, enabled: config.enabled === true, configuration,
          hasHeaders: Object.keys(config.headers ?? {}).length > 0, templates: structuredClone(diagnosticTemplates),
        }
      } catch { return invalid() }
    })
  }

  /**
   * Validate editable fields against this host's transport limits without persistence.
   * @param configuration - Endpoint and API workflows to validate.
   * @returns Successful validation; invalid data raises a value-free diagnostic.
   */
  @Remote
  validate(configuration: WorkflowConfiguration): Promise<{ valid: true }> {
    return Promise.resolve().then(() => {
      this.configuration(configuration, this.snapshot().config)
      return { valid: true }
    })
  }

  /**
   * Persist safe workflow edits disabled, retaining host headers and runtime binding.
   * @param configuration - Complete editable workflow fields; omitted URL retains the host URL.
   * @param expectedRevision - Revision read by the editor; stale writes are refused.
   * @returns Committed safe configuration and revision.
   */
  @Remote
  async save(configuration: WorkflowConfiguration, expectedRevision: number): Promise<WorkflowConfigurationView> {
    const value = this.configuration(configuration, this.snapshot().config)
    await this.write({ ...value, enabled: false }, expectedRevision)
    return this.view()
  }

  /**
   * Register or unregister saved workflow targets without starting the engine.
   * @param enabled - Desired workflow availability; disabling cancels active attempts.
   * @param expectedRevision - Revision read by the editor; stale writes are refused.
   * @returns Committed safe configuration and revision.
   */
  @Remote
  async setEnabled(enabled: boolean, expectedRevision: number): Promise<WorkflowConfigurationView> {
    if (!z.boolean().safeParse(enabled).success) return invalid()
    const { config } = this.snapshot()
    this.configuration({ ...config.baseURL === undefined ? {} : { baseURL: config.baseURL }, workflows: config.workflows ?? [] }, config)
    try { resolveConfig({ ...config, enabled }) } catch { return invalid() }
    await this.write({ enabled }, expectedRevision)
    return this.view()
  }

  private snapshot(): { config: Config; revision: number } {
    const descriptor = this.ctx.settings.describe({ redactSecrets: true }).find(section => section.ns === this.source.namespace)
    if (descriptor === undefined) throw new RemoteError('video-workflows/unavailable', 'Persistent workflow settings are unavailable.', { reason: 'settings' })
    return { config: this.source.current(), revision: descriptor.revision }
  }

  private configuration(value: unknown, machine: Config): WorkflowConfiguration {
    try {
      const parsed = configurationSchema.parse(value)
      const baseURL = parsed.baseURL ?? machine.baseURL
      if (baseURL !== undefined) resolveBaseURL(baseURL)
      const workflows = restoreWorkflows({ version: 1, workflows: parsed.workflows } as JsonValue, machine)
      if (workflows.length > 0) resolveConfig({ ...machine, ...baseURL === undefined ? {} : { baseURL }, workflows, enabled: true })
      return { ...baseURL === undefined ? {} : { baseURL }, workflows }
    } catch { return invalid() }
  }

  private async write(patch: object, expectedRevision: number): Promise<void> {
    if (!revisionSchema.safeParse(expectedRevision).success) return invalid()
    const { SettingsConflictError } = await import('@deepseek-ai/dsh-settings')
    try { await this.ctx.settings.update(this.source.namespace, patch, expectedRevision) } catch (error) {
      if (error instanceof SettingsConflictError) throw new RemoteError('video-workflows/conflict', 'Workflow settings changed. Reload before saving.', { expected: error.expected, actual: error.actual })
      throw new RemoteError('video-workflows/write-failed', 'Workflow settings could not be saved.', { reason: 'persistence' })
    }
  }
}
