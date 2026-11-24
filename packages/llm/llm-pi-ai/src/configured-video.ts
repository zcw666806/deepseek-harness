/**
 * Configured video targets shared by standalone tools and production projects.
 * @module @deepseek-ai/dsh-llm-pi-ai/configured-video
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, VideoAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ModelWithOutput } from './catalog.ts'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import { generateVideo } from './video.ts'

/** Resolves the configured or provider-native credential for one video route. */
export type ResolveVideoApiKey = (
  provider: string,
  profile: ResolvedPiAiProviderProfile,
  signal?: AbortSignal,
) => Promise<string | undefined>

/** Video parameters whose model and credentials resolve from live profiles. */
export interface ConfiguredVideoRequest {
  readonly prompt: string
  readonly model?: string
  readonly duration?: number
  readonly aspect_ratio?: string
  readonly resolution?: string
  readonly referenceImages?: readonly ImageAttachmentRef[]
}

/**
 * Return the native reference-image limit declared by this integration.
 * @param model - exact configured video model identifier.
 * @returns maximum supported references; zero means no declared reference support.
 */
export function videoReferenceLimit(model: string): number {
  return model === 'grok-imagine-video-1.5' ? 14 : model === 'grok-imagine-video' ? 7 : 0
}

/**
 * Generate with one current configured video target and save its result.
 * @param ctx - Context providing the current attachment store.
 * @param profiles - Profiles captured when the operation begins.
 * @param resolveApiKey - Credential resolver shared with conversational requests.
 * @param request - Video settings and verified durable reference images.
 * @param signal - Caller cancellation.
 * @returns The persisted video and exact model used for this attempt.
 */
export async function generateConfiguredVideo(
  ctx: Context,
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
  resolveApiKey: ResolveVideoApiKey,
  request: ConfiguredVideoRequest,
  signal?: AbortSignal,
): Promise<{ attachment: VideoAttachmentRef; model: string }> {
  signal?.throwIfAborted()
  const attachmentStore = ctx.get('attachments')
  if (attachmentStore === undefined) {
    throw new Error('generate_video: the attachments service is not available')
  }
  let route: { provider: string; profile: ResolvedPiAiProviderProfile; modelId: string; baseURL: string } | undefined
  for (const [provider, profile] of profiles) {
    const model = profile.piProvider?.getModels().find(candidate =>
      (candidate as ModelWithOutput).output?.includes('video')
      && (request.model === undefined || candidate.id === request.model))
    if (model !== undefined) {
      route = { provider, profile, modelId: model.id, baseURL: model.baseUrl }
      break
    }
  }
  if (route === undefined) {
    throw new Error(request.model !== undefined
      ? `generate_video: no configured model "${request.model}" declares video output; add "output: [text, video]" to its entry in settings.yaml`
      : 'generate_video: no video-capable model is configured; add "output: [text, video]" to a model entry in settings.yaml')
  }
  const references = request.referenceImages ?? []
  if (references.length > 0) {
    // Native model limits: https://docs.x.ai/developers/model-capabilities/video/reference-to-video
    const limit = videoReferenceLimit(route.modelId)
    if (limit === 0) throw new Error(`Video model "${route.modelId}" has no declared native reference-image support`)
    if (references.length > limit) throw new Error(`Video model "${route.modelId}" accepts at most ${limit} reference images`)
    if (route.modelId === 'grok-imagine-video' && request.duration !== undefined && request.duration > 10) {
      throw new Error('Video model "grok-imagine-video" accepts at most 10 seconds with reference images')
    }
  }
  const apiKey = await resolveApiKey(route.provider, route.profile, signal)
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(`generate_video: provider route "${route.provider}" resolved no credential`)
  }
  const result = await generateVideo({
    model: route.modelId,
    prompt: request.prompt,
    ...request.duration === undefined ? {} : { duration: request.duration },
    ...request.aspect_ratio === undefined ? {} : { aspect_ratio: request.aspect_ratio },
    ...request.resolution === undefined ? {} : { resolution: request.resolution },
  }, route.baseURL, apiKey, attachmentStore, signal, {
    ...route.profile.headers === undefined ? {} : { headers: route.profile.headers },
    pollIntervalMs: route.profile.videoPollIntervalMs,
    timeoutMs: route.profile.videoTimeoutMs,
    referenceImages: references,
  })
  return { attachment: result.attachment, model: route.modelId }
}
