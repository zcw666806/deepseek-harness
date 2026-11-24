/** Optional HTTP video provider for operator-owned ComfyUI API workflows. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-video-production'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-capability-manager'
import type { VideoGenerationResult } from '@deepseek-ai/dsh-video-production/types'
import type { CapabilityId, CapabilityProvider } from '@deepseek-ai/dsh-capability-manager/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { Config as ConfigSchema, readConfig, resolveConfig, type LiveConfig } from './config.ts'
import { generateComfyVideo, inspectComfyWorkflows } from './provider.ts'
import { exportWorkflows, restoreWorkflows } from './portable.ts'
import { VideoWorkflows } from './workflows.ts'

export { Config } from './config.ts'
export type { ComfyWorkflow, ScalarBinding, WorkflowDuration, WorkflowOutput, WorkflowSize } from './types.ts'
export { VideoWorkflows } from './workflows.ts'

/** Cordis plugin identity. */
export const name = 'video-comfyui'
/** Required project registry and durable media storage. */
export const inject = ['videoProduction', 'attachments']

/**
 * Register validated enabled workflow targets without contacting ComfyUI during load.
 * @param ctx - Effect-owning context with project and attachment services.
 * @param input - Explicit operator endpoint, templates, and transport bounds.
 */
export function apply(ctx: Context, input: LiveConfig): void {
  const current = () => readConfig(input)
  const namespace = ctx.fiber.entry?.options.id ?? name
  ctx.on('internal/config', (fiber, next) => {
    const raw: unknown = next()
    if (fiber === ctx.fiber) {
      resolveConfig(readConfig(ConfigSchema(raw as Parameters<typeof ConfigSchema>[0])))
    }
    return raw
  })
  let unregister: (() => void) | undefined
  let epoch = new AbortController()
  const lifetime = new AbortController()
  const running = new Set<Promise<VideoGenerationResult>>()
  const resolved = () => resolveConfig(current())
  const update = (): void => {
    const config = resolved()
    if (!config.enabled) {
      unregister?.()
      unregister = undefined
      epoch.abort(new Error('The ComfyUI workflow provider was disabled.'))
      epoch = new AbortController()
      return
    }
    if (unregister !== undefined) return
    unregister = ctx.videoProduction.registerGenerator('comfyui', (request, signal) => {
      const config = resolved()
      const active = AbortSignal.any([signal, lifetime.signal, epoch.signal])
      const operation = (async () => {
        if (config.managedCapability !== undefined) {
          const capabilities = ctx.get('capabilities')
          if (capabilities === undefined) throw new Error('The configured runtime capability manager is unavailable.')
          const view = await capabilities.perform(brandString<CapabilityId>(config.managedCapability), 'start', active)
          if (view.status !== 'ready') throw new Error('The managed video runtime is not ready.')
        }
        return await generateComfyVideo(ctx.attachments, config, request, active)
      })()
      running.add(operation)
      return operation.finally(() => { running.delete(operation) })
    }, () => resolved().workflows.map(workflow => ({
      title: workflow.title, model: workflow.id, revision: workflow.revision,
      limits: {
        durations: workflow.durations,
        aspectRatios: [...new Set(workflow.sizes.map(size => size.aspectRatio))],
        resolutions: [...new Set(workflow.sizes.map(size => size.resolution))],
        minReferenceImages: workflow.references.length, maxReferenceImages: workflow.references.length,
      },
    })))
  }
  update()
  ctx.on('loader/volatile-update', update)
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    settingsCtx.plugin(VideoWorkflows, { namespace, current })
  })
  ctx.inject(['capabilities'], (capabilityCtx) => {
    const write = async (patch: object): Promise<void> => {
      const settings = ctx.get('settings')
      if (settings === undefined) throw new Error('Persistent settings are required to change workflow configuration.')
      await settings.update(namespace, patch)
    }
    const provider: CapabilityProvider = {
      descriptor: {
        id: brandString<CapabilityId>('video.comfyui'), title: 'ComfyUI workflows', category: 'video', engineId: 'comfyui-workflows',
        version: '1', kind: 'remote', description: 'Configured video workflows with replaceable model bindings',
      },
      async inspect(signal) {
        signal.throwIfAborted()
        const raw = current()
        const workflows = raw.workflows ?? []
        if (raw.enabled === true && workflows.length > 0) return inspectComfyWorkflows(resolved(), signal)
        return {
          status: workflows.length === 0 ? 'missing' : raw.enabled === true ? 'ready' : 'stopped',
          requirements: [{ id: 'workflows', title: 'Video workflows', status: workflows.length === 0 ? 'missing' : 'available' }],
        }
      },
      async start(signal) {
        signal.throwIfAborted()
        resolveConfig({ ...current(), enabled: true })
        const target = current().managedCapability
        if (target !== undefined) await capabilityCtx.capabilities.perform(brandString<CapabilityId>(target), 'start', signal)
        await write({ enabled: true })
      },
      async stop(signal) {
        signal.throwIfAborted()
        await write({ enabled: false })
        await Promise.allSettled(running)
      },
      exportConfiguration(signal) { signal.throwIfAborted(); return Promise.resolve(exportWorkflows(current())) },
      async restoreConfiguration(configuration: JsonValue, signal: AbortSignal) {
        signal.throwIfAborted()
        const workflows = restoreWorkflows(configuration, current())
        await write({ enabled: false, workflows })
      },
    }
    const remove = capabilityCtx.capabilities.register(provider)
    capabilityCtx.effect(() => remove, 'portable ComfyUI workflow configuration')
  })
  ctx.effect(() => async () => {
    unregister?.()
    lifetime.abort(new Error('The ComfyUI video provider was unloaded.'))
    await Promise.allSettled(running)
  }, 'ComfyUI video provider operations')
}
