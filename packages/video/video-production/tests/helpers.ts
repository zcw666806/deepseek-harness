import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import VideoProduction, { VideoShotId } from '../src/index.ts'
import type { Config, VideoProject, VideoProjectInput, VideoShotInput } from '../src/types.ts'

export const modules = new Map<string, unknown>([
  ['sessions', SessionStore], ['persistence', JsonlSessionPersistence], ['storage', Storage],
  ['storage-json', StorageJson], ['storage-domain', StorageDomain], ['attachments', LocalAttachmentStore],
  ['session-projection', SessionProjectionRegistry], ['system-prompt', SystemPrompt], ['tools', ToolRuntime], ['video-production', VideoProduction],
])

export function shot(id: string, patch: Partial<VideoShotInput> = {}): VideoShotInput {
  return {
    id: VideoShotId(id), title: id, prompt: `A view of ${id}`, duration: 2,
    aspectRatio: '16:9', resolution: '480p', assetIds: [], position: { x: 0, y: 0 }, ...patch,
  }
}

export function projectInput(): VideoProjectInput {
  return { revision: 0, title: 'A short film', assets: [], shots: [shot('first'), shot('second')] }
}

export function editable(project: VideoProject): VideoProjectInput {
  return {
    revision: project.revision, title: project.title, assets: project.assets,
    shots: project.shots.map(({ versions: _versions, ...input }) => input),
  }
}

export async function persistSession(ctx: Context, session: Session): Promise<void> {
  await using handle = await ctx.sessionPersistence.create(session.header)
  await handle.flush()
}

export async function setup(config: Config = {}, existingRoot?: string) {
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), 'dsh-video-production-test-'))
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: join(root, 'storage') })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(VideoProduction, config)
    const sessionId = SessionId('video-production-session')
    if (existingRoot === undefined) {
      const session = ctx.sessions.create(sessionId, { meta: { cwd: root } })
      await persistSession(ctx, session)
    }
    return {
      ctx, root, fiber, sessionId,
      async dispose(remove = true) {
        await ctx.fiber.dispose()
        if (remove) await rm(root, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await ctx.fiber.dispose()
    if (existingRoot === undefined) await rm(root, { recursive: true, force: true })
    throw error
  }
}

export function signal(): AbortSignal { return new AbortController().signal }

export const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC'
export const sceneImageData = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWP4lWL0K8WIAUIBAC7uBkFP2lNsAAAAAElFTkSuQmCC'

export async function video(ctx: Context, marker = 1) {
  return await ctx.attachments.saveVideo({
    data: Uint8Array.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, marker]),
    mediaType: 'video/mp4', durationSeconds: 2, width: 854, height: 480,
  })
}
