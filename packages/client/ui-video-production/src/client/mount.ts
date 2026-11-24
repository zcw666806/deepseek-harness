/** Remote mount lifecycle and Session-bound callbacks for the video production workspace. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-video-production/remote'
import type {} from '@deepseek-ai/dsh-capability-manager/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ProjectDirectory } from './project-directory.ts'
import { ProductionController } from './controller.ts'
import { createVideoCanvasStore } from './canvas-store.ts'
import { VideoProductionView } from './VideoProductionView.tsx'
import { GeneratedVideoCard, type GeneratedVideoFace } from './GeneratedVideoCard.tsx'
import { ConversationVideoModel } from './ConversationVideoModel.tsx'
import { StoryboardCanvasAction } from './StoryboardCanvasAction.tsx'
import { en, NS, zh, type VideoProductionKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Storyboard editing, media previews, and film sequence copy. */
    videoProduction: VideoProductionKey
  }
}

/** Services required before mounting the generated video Remote namespace. */
export const inject = ['remote', 'sessions', 'slots', 'locale']

async function unwrap<Value>(pending: Promise<RemoteResult<Value>>): Promise<Value> {
  const result = await pending
  if (!result.ok) throw result.error
  return result.value
}

function registerWorkspace(ctx: Context, batchPollIntervalMs: number): void {
  const controllers = new Map<SessionId, ProductionController>()
  let directory: ProjectDirectory | undefined
  ctx.inject(['uiWorkspace', 'remote.videoProduction'], (workspaceCtx) => {
    const resident = new ProjectDirectory((ids, signal) => unwrap(workspaceCtx.remote.videoProduction.projectSummaries([...ids], signal)))
    directory = resident
    const removePresentation = workspaceCtx.uiWorkspace.registerSessionPresentation(resident.source)
    let roster = new Set<SessionId>()
    const refreshDirectory = (): void => {
      const { phase, ids } = ctx.sessions.list.getSnapshot()
      if (phase !== 'ready' || (ids.length === roster.size && ids.every(id => roster.has(id)))) return
      roster = new Set(ids)
      resident.refresh(ids)
    }
    workspaceCtx.effect(() => ctx.sessions.list.subscribe(refreshDirectory), 'video project directory: Session roster')
    workspaceCtx.on('connection/reset', () => {
      roster.clear()
      resident.reset()
      refreshDirectory()
    })
    workspaceCtx.effect(() => async () => {
      if (directory === resident) directory = undefined
      await resident.dispose()
      removePresentation()
    }, 'video project directory: settled presentation lifetime')
    refreshDirectory()
    workspaceCtx.effect(() => workspaceCtx.uiWorkspace.registerSessionReuseGuard(async (sessionId) => {
      const current = controllers.get(sessionId)?.inject().hooks.production.getSnapshot()
      if (current !== undefined && (current.operation !== null || (current.project !== null && current.project.revision > 0))) return false
      const project = await unwrap(workspaceCtx.remote.videoProduction.view(sessionId))
      return project.revision === 0
    }), 'ui-video-production: protect project-bearing Sessions from reuse')
  })
  const controllerFor = (sessionId: SessionId): ProductionController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new ProductionController({
        startBatch: input => unwrap(ctx.remote.videoProduction.startBatch(sessionId, input)),
        batch: () => unwrap(ctx.remote.videoProduction.batch(sessionId)),
        pauseBatch: id => unwrap(ctx.remote.videoProduction.pauseBatch(sessionId, id)),
        cancelBatch: id => unwrap(ctx.remote.videoProduction.cancelBatch(sessionId, id)),
        resumeBatch: id => unwrap(ctx.remote.videoProduction.resumeBatch(sessionId, id)),
        restoreCapabilities: (manifest, signal) => unwrap(ctx.remote.capabilities.restoreManifest(manifest, signal)),
        prepareProjectExport: signal => unwrap(ctx.remote.videoProduction.prepareProjectExport(sessionId, signal)),
        readProjectTransfer: (id, offset, length, signal) => unwrap(
          ctx.remote.videoProduction.readProjectTransfer(sessionId, id, offset, length, signal),
        ),
        beginProjectImport: (bytes, signal) => unwrap(ctx.remote.videoProduction.beginProjectImport(sessionId, bytes, signal)),
        writeProjectTransfer: (id, offset, data, signal) => unwrap(
          ctx.remote.videoProduction.writeProjectTransfer(sessionId, id, offset, data, signal),
        ),
        commitProjectImport: (id, signal) => unwrap(ctx.remote.videoProduction.commitProjectImport(sessionId, id, signal)),
        cancelProjectTransfer: id => unwrap(ctx.remote.videoProduction.cancelProjectTransfer(sessionId, id)),
        generationTargets: () => unwrap(ctx.remote.videoProduction.generationTargets()),
        view: () => unwrap(ctx.remote.videoProduction.view(sessionId)),
        update: input => unwrap(ctx.remote.videoProduction.update(sessionId, input)),
        generate: (shotId, options, signal) => unwrap(ctx.remote.videoProduction.generate(sessionId, shotId, options, signal)),
        reorder: shotIds => unwrap(ctx.remote.videoProduction.reorder(sessionId, [...shotIds])),
        export: signal => unwrap(ctx.remote.videoProduction.export(sessionId, signal)),
        readMedia: (projectId, attachmentId, offset, length) => unwrap(
          ctx.remote.videoProduction.readMedia(sessionId, projectId, attachmentId, offset, length),
        ),
        addAsset: (input, signal) => unwrap(ctx.remote.videoProduction.addAsset(sessionId, input, signal)),
      }, undefined, project => directory?.observe(project), batchPollIntervalMs)
      controllers.set(sessionId, controller)
      const resident = controller
      const sessionScope = ctx.sessions.scope(sessionId)
      if (sessionScope === undefined) throw new Error(`Video production Session "${sessionId}" is unavailable.`)
      const releaseScope = sessionScope.effect(() => async () => {
        await resident.dispose()
        controllers.delete(sessionId)
      }, 'ui-video-production: Session media owner')
      ctx.effect(() => releaseScope, 'ui-video-production: Session cleanup registration')
    }
    return controller
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-video-production: dictionaries')
  ctx.effect(() => async () => {
    await Promise.all([...controllers.values()].map(controller => controller.dispose()))
    controllers.clear()
  }, 'ui-video-production: media URLs and pending operations')
  ctx.on('connection/reset', () => {
    for (const controller of controllers.values()) controller.resetConnection()
  })
  ctx.slots.inject('studio', () => ctx.slots.register({
    name: 'studio', key: 'video', locale: NS,
    store: createVideoCanvasStore,
    inject: (sessionId: SessionId) => {
      const face = controllerFor(sessionId).inject()
      return { ...face, refresh: () => { directory?.refresh(); face.refresh() } }
    },
  }, VideoProductionView))
  ctx.slots.inject('conversation.input.creation-model', () => ctx.slots.register({
    name: 'conversation.input.creation-model', key: 'video', locale: NS,
    inject: (sessionId: SessionId) => ({
      load: async (signal: AbortSignal) => {
        const [targets, selected] = await Promise.all([
          unwrap(ctx.remote.videoProduction.conversationGenerationTargets()),
          unwrap(ctx.remote.videoProduction.conversationGenerationTarget(sessionId, signal)),
        ])
        return { targets, selected }
      },
      select: (model: string, signal: AbortSignal) => unwrap(
        ctx.remote.videoProduction.selectConversationGenerationTarget(sessionId, model, signal),
      ),
    }),
  }, ConversationVideoModel))
  ctx.inject(['layout'], (layoutCtx) => {
    layoutCtx.slots.inject('conversation.chat.assistant-follow-up', () => layoutCtx.slots.register({
      name: 'conversation.chat.assistant-follow-up', id: 'video-storyboard', locale: NS,
      inject: (sessionId: SessionId) => ({
        openStoryboard: async (path: string, signal: AbortSignal) => {
          await unwrap(layoutCtx.remote.videoProduction.importWorkspaceStoryboard(sessionId, path, signal))
          signal.throwIfAborted()
          if ((layoutCtx.sessions.retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0) > 0) layoutCtx.layout.showStudio?.('video')
        },
      }),
    }, StoryboardCanvasAction))
  })
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: 'generate_video', locale: NS,
    inject: (sessionId: SessionId): GeneratedVideoFace => ({
      readVideo: (attachmentId, offset, length) => unwrap(ctx.remote.session.videoAttachment({
        sessionId, attachmentId, offset, length,
      })),
    }),
  }, GeneratedVideoCard))
}

/**
 * Mount the generated Remote contribution and the disposable workspace entry.
 * @param ctx - browser plugin Context carrying Remote, slots, and locale services.
 * @param contribution - generated descriptors for the video production Host controller.
 * @param batchPollIntervalMs - validated polling delay from plugin configuration.
 * @returns disposer for UI effects and the mounted Remote namespace.
 */
export async function mountVideoProductionUi(
  ctx: Context,
  contribution: TypertRemoteContribution,
  batchPollIntervalMs: number,
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote', 'remote.videoProduction', 'remote.capabilities', 'remote.session', 'sessions', 'slots', 'locale'],
    (child) =>{  registerWorkspace(child, batchPollIntervalMs) })
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
