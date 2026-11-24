/** Generation-target identity and input compatibility for explicit operation selection. */
import type { VideoGenerationTarget, VideoShotInput } from '@deepseek-ai/dsh-video-production/types'

/**
 * Identify a configured generator/model pair without conflating it with its display title.
 * @param target - one Host-advertised configured target.
 * @returns stable local select value.
 */
export function generationTargetKey(target: VideoGenerationTarget): string {
  return JSON.stringify([target.generator, target.model ?? null])
}

/**
 * Check only restrictions advertised by the selected generation target.
 * @param target - configured target and its actual supported input values.
 * @param shot - saved or staged shot values.
 * @returns whether the target accepts the shot's duration, dimensions and reference count.
 */
export function acceptsShot(target: VideoGenerationTarget, shot: VideoShotInput): boolean {
  const limits = target.limits
  return (limits?.durations === undefined || limits.durations.includes(shot.duration))
    && (limits?.aspectRatios === undefined || limits.aspectRatios.includes(shot.aspectRatio))
    && (limits?.resolutions === undefined || limits.resolutions.includes(shot.resolution))
    && (limits?.minReferenceImages === undefined || shot.assetIds.length >= limits.minReferenceImages)
    && (limits?.maxReferenceImages === undefined || shot.assetIds.length <= limits.maxReferenceImages)
}
