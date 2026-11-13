/** Browser entry for the Session-owned video production workspace. */

import type { Context } from '@deepseek-ai/cordis'
import videoProductionRemote from '@deepseek-ai/dsh-video-production/remote'
import { mountVideoProductionUi } from './mount.ts'
import { resolveWorkspaceConfig, type VideoWorkspaceConfig } from '../config.ts'
export { Config } from '../config.ts'

export { inject } from './mount.ts'
export { createVideoCanvasStore } from './canvas-store.ts'
export type { ProductionFace, ProductionSnapshot } from './controller.ts'
export type { VideoProductionViewProps } from './VideoProductionView.tsx'

/**
 * Mount the generated video Remote namespace and register its workspace view.
 * @param ctx - browser Context containing Remote, slots, and locale services.
 * @param config - Deployment observation cadence, validated by the owner schema.
 * @returns asynchronous disposer for the namespace and UI registrations.
 */
export async function apply(ctx: Context, config: VideoWorkspaceConfig = {}): Promise<() => Promise<void>> {
  return await mountVideoProductionUi(ctx, videoProductionRemote, resolveWorkspaceConfig(config).batchPollIntervalMs)
}
