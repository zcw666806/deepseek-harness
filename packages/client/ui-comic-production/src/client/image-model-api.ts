/** Bind image model catalog and selection to a studio Session. */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-comic-production/remote'
import type { ComicImageGenerationTarget, ComicImageGenerationTargetId } from '@deepseek-ai/dsh-comic-production/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Operations for the comic studio's image generation model control. */
export interface ComicImageModelApi {
  readonly load: (signal: AbortSignal) => Promise<{
    readonly targets: readonly ComicImageGenerationTarget[]
    readonly selected: ComicImageGenerationTargetId | undefined
  }>
  readonly select: (targetId: ComicImageGenerationTargetId) => Promise<void>
}

async function unwrap<Value>(pending: Promise<RemoteResult<Value>>): Promise<Value> {
  const result = await pending
  if (!result.ok) throw result.error
  return result.value
}

/**
 * Bind model choice and catalog requests to the current studio Session.
 * @param ctx - Client context with the mounted comic production namespace.
 * @param sessionId - Session whose storyboard will use the selected model.
 * @returns The image model control's operations.
 */
export function imageModelApi(ctx: Context, sessionId: SessionId): ComicImageModelApi {
  const remote = ctx.remote.comicProduction
  return {
    load: async (signal) => {
      const [targets, selected] = await Promise.all([
        unwrap(remote.storyboardGenerationTargets(signal)),
        unwrap(remote.storyboardGenerationTarget(sessionId, signal)),
      ])
      return { targets, selected }
    },
    select: async (targetId) => { await unwrap(remote.selectStoryboardGenerationTarget(sessionId, targetId)) },
  }
}
