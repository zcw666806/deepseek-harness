/** Mount the comic project view and its generated Remote namespace. */

import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ComicProjectPackage } from '@deepseek-ai/dsh-comic-production/types'
import comicProductionRemote from '@deepseek-ai/dsh-comic-production/remote'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ComicWorkbench, type ComicWorkbenchApi } from './ComicWorkbench.tsx'
import { en, NS, zh, type ComicProductionKey } from './locales.ts'

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

/**
 * Mount the generated Remote contribution and the conversation view.
 * @param ctx - Browser context providing the Remote, slots, and locale services.
 * @returns Disposer for the view, locale, and Remote registration.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(comicProductionRemote)
  const ui = ctx.inject(['remote.comicProduction', 'slots', 'locale'], (child) => {
    child.effect(() => child.locale.register(NS, { zh, en }), 'comic workspace dictionaries')
    const t = child.locale.bind(NS)
    child.slots.inject('conversation.view', () => child.slots.register({
      name: 'conversation.view',
      id: 'comic-production',
      order: 22,
      locale: NS,
      label: () => t('view.title'),
      inject: (sessionId: SessionId) => ({ api: projectApi(child, sessionId) }),
    }, ComicWorkbench))
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
