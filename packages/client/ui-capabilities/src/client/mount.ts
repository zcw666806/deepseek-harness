/** Settings contribution over the globally mounted capability Remote. */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-capability-manager/remote'
import type {} from '@deepseek-ai/dsh-video-comfyui/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { CapabilityController } from './controller.ts'
import { CapabilitySection } from './CapabilitySection.tsx'
import { WorkflowController } from './workflow-controller.ts'
import { WorkflowSection } from './WorkflowSection.tsx'
import { en, zh, type CapabilityKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Host capability state, requirements and fixed actions. */
    capabilities: CapabilityKey
  }
}
/** Services used while mounting the generated Remote and settings contribution. */
export const inject = ['remote', 'remote.capabilities', 'slots', 'locale']
async function unwrap<Value>(pending: Promise<RemoteResult<Value>>): Promise<Value> {
  const result = await pending
  if (!result.ok) throw result.error
  return result.value
}
function register(ctx: Context): void {
  const controller = new CapabilityController({
    exportManifest: signal => unwrap(ctx.remote.capabilities.exportManifest(signal)),
    planRestore: (manifest, signal) => unwrap(ctx.remote.capabilities.planRestore(manifest, signal)),
    restoreManifest: (manifest, signal) => unwrap(ctx.remote.capabilities.restoreManifest(manifest, signal)),
    list: signal => unwrap(ctx.remote.capabilities.list(signal)),
    perform: (id, action, signal) => unwrap(ctx.remote.capabilities.perform(id, action, signal)),
  })
  ctx.effect(() => () => controller.dispose(), 'capabilities: operation owner')
  ctx.on('connection/reset', () => { controller.reset() })
  ctx.effect(() => ctx.locale.register('capabilities', { zh, en }), 'capabilities: dictionaries')
  ctx.inject(['remote.videoWorkflows'], (workflowCtx) => {
    const workflows = new WorkflowController({
      view: () => unwrap(workflowCtx.remote.videoWorkflows.view()),
      validate: configuration => unwrap(workflowCtx.remote.videoWorkflows.validate(configuration)),
      save: (configuration, revision) => unwrap(workflowCtx.remote.videoWorkflows.save(configuration, revision)),
      setEnabled: (enabled, revision) => unwrap(workflowCtx.remote.videoWorkflows.setEnabled(enabled, revision)),
    })
    workflowCtx.effect(() => () => workflows.dispose(), 'video workflows: operation owner')
    workflowCtx.on('connection/reset', () => { workflows.reset() })
    workflowCtx.slots.inject('settings.section', () => workflowCtx.slots.register({
      name: 'settings.section', id: 'video-workflows', order: 26, locale: 'capabilities',
      label: () => workflowCtx.locale.bind('capabilities')('workflow.nav'), inject: () => workflows.inject(),
    }, WorkflowSection))
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'capabilities', order: 25, locale: 'capabilities',
    label: () => ctx.locale.bind('capabilities')('nav'), inject: () => controller.inject(),
  }, CapabilitySection))
}
/**
 * Mount the settings contribution using the global capability namespace.
 * @param ctx - browser plugin context.
 * @returns disposer that cancels owned requests and withdraws only this settings section.
 */
export async function mountCapabilities(ctx: Context): Promise<() => Promise<void>> {
  const ui = ctx.inject(['remote', 'remote.capabilities', 'slots', 'locale'], register)
  try { await ui } catch (error) { await ui.dispose(); throw error }
  return async () => { await ui.dispose() }
}
