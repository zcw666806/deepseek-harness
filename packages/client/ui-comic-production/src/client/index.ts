/** Mount the comic creation workbench and its generated Remote namespace. */

import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ComicImageGenerationTargetId, ComicProjectId, ComicProjectPackage } from '@deepseek-ai/dsh-comic-production/types'
import comicProductionRemote from '@deepseek-ai/dsh-comic-production/remote'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComicWorkbenchApi } from './ComicWorkbench.tsx'
import { ComicStudio, type ComicStudioInjected, type ComicProjectRequest } from './ComicStudio.tsx'
import { ComicImageModel } from './ComicImageModel.tsx'
import { imageModelApi } from './image-model-api.ts'
import { en, NS, zh, type ComicProductionKey } from './locales.ts'
import { StoryboardAction, type StoryboardActionApi, type StoryboardActionInjected } from './StoryboardAction.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Comic layout, lettering, and artwork revision controls. */
    comicProduction: ComicProductionKey
  }
}

/** Browser services required to mount the comic workbench. */
export const inject = ['remote', 'slots', 'locale']

async function unwrap<Value>(pending: Promise<RemoteResult<Value>>): Promise<Value> {
  const result = await pending
  if (!result.ok) throw result.error
  return result.value
}

function encodeFile(file: File, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const reader = new FileReader()
    const abort = (): void => { reader.abort() }
    reader.onloadend = () => { signal?.removeEventListener('abort', abort) }
    reader.onerror = () => { reject(reader.error ?? new Error('comic-production: image read failed')) }
    reader.onabort = () => { reject(new DOMException('The image read was aborted.', 'AbortError')) }
    reader.onload = () => {
      const data = reader.result
      if (typeof data !== 'string') {
        reject(new Error('comic-production: image encoding returned no data'))
        return
      }
      resolve(data.slice(data.indexOf(',') + 1))
    }
    signal?.addEventListener('abort', abort, { once: true })
    reader.readAsDataURL(file)
  })
}

function projectApi(ctx: Context, sessionId: SessionId): ComicWorkbenchApi {
  const remote = ctx.remote.comicProduction
  return {
    list: signal => unwrap(remote.list(sessionId, signal)),
    create: (title, signal) => unwrap(remote.create(sessionId, title, signal)),
    open: (id, signal) => unwrap(remote.open(sessionId, id, signal)),
    save: (id, revision, draft, signal) => unwrap(remote.save(sessionId, id, revision, draft, signal)),
    saveLayerImage: async (id, revision, panelId, layerId, file, signal) => {
      const data = await encodeFile(file, signal)
      return await unwrap(remote.saveLayerImage(sessionId, id, revision, panelId, layerId, data, signal))
    },
    readImage: async (projectId, image, signal) => {
      const bytes = new Uint8Array(image.bytes)
      let offset = 0
      while (offset < bytes.length) {
        const chunk = await unwrap(remote.readImage(sessionId, projectId, image.id, offset, 128 * 1024, signal))
        const decoded = atob(chunk.data)
        const end = offset + decoded.length
        if (chunk.offset !== offset || chunk.nextOffset !== end || end <= offset || end > bytes.length
          || chunk.done !== (end === bytes.length)) {
          throw new Error('comic-production: invalid image transfer range')
        }
        for (let index = 0; index < decoded.length; index++) bytes[offset + index] = decoded.charCodeAt(index)
        offset = end
      }
      return new Blob([bytes], { type: 'image/png' })
    },
    exportProject: async (id, signal) => {
      const data = await unwrap(remote.exportProject(sessionId, id, signal))
      return new Blob([JSON.stringify(data)], { type: 'application/json' })
    },
    importProject: async (file, signal) => {
      const data = JSON.parse(await file.text()) as ComicProjectPackage
      signal?.throwIfAborted()
      return await unwrap(remote.importProject(sessionId, data, signal))
    },
  }
}

function storyboardApi(ctx: Context, sessionId: SessionId): Omit<StoryboardActionApi, 'openEditor'> {
  const remote = ctx.remote.comicProduction
  return {
    readImage: projectApi(ctx, sessionId).readImage,
    generationAvailable: signal => unwrap(remote.storyboardGenerationAvailable(sessionId, signal)),
    result: (messageId, signal) => unwrap(remote.storyboardResult(sessionId, messageId, signal)),
    generate: (messageId, draft, artDirection) => unwrap(remote.generateStoryboard(sessionId, messageId, draft, artDirection)),
    importProject: (data, signal) => unwrap(remote.importProject(sessionId, data, signal)),
  }
}

/**
 * Mount the generated Remote contribution and the creation workbench.
 * @param ctx - Browser context providing the Remote, slots, and locale services.
 * @returns Disposer for the view, locale, and Remote registration.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(comicProductionRemote)
  const ui = ctx.inject(['remote.comicProduction', 'sessions', 'slots', 'locale', 'layout'], (child) => {
    const projectRequest = createSnapshotStore<ComicProjectRequest | null>(null)
    const generationChanges = createSnapshotStore<{ sessionId: SessionId } | null>(null)
    child.effect(() => child.locale.register(NS, { zh, en }), 'comic workspace dictionaries')
    child.slots.inject('studio', () => child.slots.register({
      name: 'studio',
      key: 'comic',
      locale: NS,
      inject: (sessionId: SessionId): ComicStudioInjected => ({
        api: projectApi(child, sessionId),
        hooks: { projectRequest },
        completeProjectRequest: (request) => {
          if (projectRequest.getSnapshot() === request) projectRequest.set(null)
        },
      }),
    }, ComicStudio))
    child.slots.inject('conversation.input.creation-model', () => child.slots.register({
      name: 'conversation.input.creation-model',
      key: 'comic',
      locale: NS,
      inject: (sessionId: SessionId) => {
        const api = imageModelApi(child, sessionId)
        return {
          api: {
            ...api,
            select: async (target: ComicImageGenerationTargetId) => {
              await api.select(target)
              generationChanges.set({ sessionId })
            },
          },
        }
      },
    }, ComicImageModel))
    child.slots.inject('conversation.chat.assistant-follow-up', () => child.slots.register({
      name: 'conversation.chat.assistant-follow-up',
      id: 'comic-storyboard',
      locale: NS,
      inject: (sessionId: SessionId): StoryboardActionInjected => ({
        hooks: { generationChanges },
        api: {
          ...storyboardApi(child, sessionId),
          openEditor: (projectId: ComicProjectId) => {
            if (!(child.sessions.retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0)) return
            projectRequest.set({ sessionId, projectId })
            child.layout.showStudio?.('comic')
          },
        },
      }),
    }, StoryboardAction))
  })
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
