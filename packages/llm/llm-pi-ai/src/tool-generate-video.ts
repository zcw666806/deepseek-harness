/**
 * Model-facing `generate_video` tool: async video generation over the xAI native
 * video API (`POST /v1/videos/generations`, poll, download). Any chat model may
 * call it; the video model it targets is the configured model whose entry
 * declares `output: [text, video]`, resolved across this adapter's provider
 * routes at execution time.
 * @module @deepseek-ai/dsh-llm-pi-ai/tool-generate-video
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-attachment'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import { generateConfiguredVideo } from './configured-video.ts'
import type { ResolveVideoApiKey } from './configured-video.ts'

/**
 * Model-facing summary of one generated video. The calling model reads text,
 * not video bytes, so the result names the durable attachment and its metadata;
 * presentation metadata retains the same attachment reference for consumers.
 * @param value - the validated canonical tool value.
 * @returns the text the model receives as the tool result.
 */
function renderGeneratedVideo(value: JsonValue): string {
  const attachment = (value as { attachment?: Record<string, JsonValue> }).attachment
  if (attachment === undefined) return 'Video generated.'
  const mediaType = typeof attachment.mediaType === 'string' ? attachment.mediaType : 'video/mp4'
  const attachmentId = typeof attachment.attachmentId === 'string' ? attachment.attachmentId : 'unknown'
  const bytes = typeof attachment.bytes === 'number' ? attachment.bytes : undefined
  const size = bytes === undefined ? '' : `, ${Math.round(bytes / 1024)} KiB`
  const duration = typeof attachment.durationSeconds === 'number'
    ? `, ${attachment.durationSeconds}s`
    : ''
  const dimensions = typeof attachment.width === 'number' && typeof attachment.height === 'number'
    ? `, ${attachment.width}x${attachment.height}`
    : ''
  return `Video generated (${mediaType}${dimensions}${duration}${size}). `
    + `Attachment: ${attachmentId}`
}

/**
 * Register the `generate_video` tool.
 * @param ctx - registrant context; its fiber owns the registration.
 * @param profiles - reads the current resolved provider profiles for each execution.
 * @param resolveApiKey - resolves one route's credential, shared with chat requests.
 * @returns the tool registration disposer.
 */
export function registerGenerateVideoTool(
  ctx: Context,
  profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>,
  resolveApiKey: ResolveVideoApiKey,
): () => void {
  const tool: ToolDefinition = defineTool({
    name: 'generate_video',
    description:
      'Generate a short video from a text prompt using a video generation model. '
      + 'This tool submits the request, polls until the video is ready (typically 30-120 seconds), '
      + 'downloads the result, and stores it as a durable attachment. '
      + 'Use this when the user asks to create or generate a video.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'Detailed text description of the video to generate (e.g., "A cat playing piano in a sunlit room, tracking shot, cinematic lighting").',
      },
      model: {
        type: 'string',
        description: 'Optional video model id (e.g., "grok-imagine-video-1.5"). Defaults to the first configured video-capable model.',
      },
      duration: {
        type: 'integer',
        enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        description: 'Video duration in seconds, 1 through 15 (default 6).',
      },
      aspect_ratio: {
        type: 'string',
        enum: ['16:9', '9:16', '1:1'],
        description: 'Video aspect ratio (default "16:9"). Use "9:16" for vertical/mobile.',
      },
      resolution: {
        type: 'string',
        enum: ['480p', '720p'],
        description: 'Video resolution (default "480p"). Use "720p" for higher quality.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', const: 'video', required: true },
          attachment: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer' },
              height: { type: 'integer' },
              durationSeconds: { type: 'number' },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderGeneratedVideo(value) }],
      presentationMeta: (_args, value) => value,
    },
    async execute(args, exec) {
      const { prompt, model, duration, aspect_ratio, resolution } = args as {
        prompt: string
        model?: string
        duration?: number
        aspect_ratio?: '16:9' | '9:16' | '1:1'
        resolution?: '480p' | '720p'
      }

      const videoBlock = await generateConfiguredVideo(
        ctx,
        profiles(),
        resolveApiKey,
        {
          prompt,
          ...model === undefined ? {} : { model },
          ...duration !== undefined ? { duration } : {},
          ...aspect_ratio !== undefined ? { aspect_ratio } : {},
          ...resolution !== undefined ? { resolution } : {},
        },
        exec.signal,
      )

      // Canonical JSON value: the schema declares a plain string id, while the
      // stored reference carries the branded `AttachmentId`.
      const ref = videoBlock.attachment
      return {
        type: 'video' as const,
        attachment: {
          attachmentId: String(ref.attachmentId),
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          ...ref.width !== undefined ? { width: ref.width } : {},
          ...ref.height !== undefined ? { height: ref.height } : {},
          ...ref.durationSeconds !== undefined ? { durationSeconds: ref.durationSeconds } : {},
          ...ref.name !== undefined ? { name: ref.name } : {},
        },
      }
    },
  })

  return ctx.tools.register(tool)
}
