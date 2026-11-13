/**
 * Native xAI generation provider for durable video-production projects.
 * @module @deepseek-ai/dsh-llm-pi-ai/video-production
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-video-production'
import type { VideoGenerationResult, VideoGeneratorDetails } from '@deepseek-ai/dsh-video-production/types'
import type { ModelWithOutput } from './catalog.ts'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import { generateConfiguredVideo, videoReferenceLimit } from './configured-video.ts'
import type { ResolveVideoApiKey } from './configured-video.ts'

/**
 * Contribute current configured video models to the production service.
 * @param ctx - Registration context with the video-production service present.
 * @param profiles - Resolves provider settings at the beginning of each attempt.
 * @param resolveApiKey - Credential resolver shared with chat and standalone video.
 * @returns Disposer removing this provider, cancelling its active attempts, and awaiting their settlement.
 */
export function registerVideoProductionGenerator(
  ctx: Context,
  profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>,
  resolveApiKey: ResolveVideoApiKey,
): () => Promise<void> {
  const lifetime = new AbortController()
  const running = new Set<Promise<VideoGenerationResult>>()
  const unregister = ctx.videoProduction.registerGenerator('llm-pi-ai', (request, signal) => {
    const result = generateConfiguredVideo(
      ctx,
      profiles(),
      resolveApiKey,
      {
        prompt: request.prompt,
        ...request.model === undefined ? {} : { model: request.model },
        duration: request.duration,
        aspect_ratio: request.aspectRatio,
        resolution: request.resolution,
        referenceImages: request.referenceImages,
      },
      AbortSignal.any([signal, lifetime.signal]),
    )
    running.add(result)
    return result.finally(() => { running.delete(result) })
  }, () => {
    const models = new Map<string, VideoGeneratorDetails>()
    for (const profile of profiles().values()) {
      for (const model of profile.piProvider.getModels()) {
        if (!(model as ModelWithOutput).output?.includes('video') || models.has(model.id)) continue
        models.set(model.id, {
          title: profile.displayName, model: model.id,
          limits: { maxReferenceImages: videoReferenceLimit(model.id) },
        })
      }
    }
    return [...models.values()]
  })
  return ctx.effect(() => async () => {
    unregister()
    lifetime.abort(new Error('The video generation provider was unloaded.'))
    await Promise.allSettled(running)
  }, 'video-production provider operations')
}
