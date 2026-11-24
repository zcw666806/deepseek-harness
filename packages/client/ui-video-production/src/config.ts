/** Validated observation cadence for the video workspace's Host-owned production batches. */
import s from '@deepseek-ai/schemastery'

/** Browser observation policy; it does not control Host execution or engine polling. */
export interface VideoWorkspaceConfig {
  /** Interval between completed batch observations; integer 100–60,000 ms, default 1,500. */
  readonly batchPollIntervalMs?: number
}

/** Loader schema shared by Host and Client faces. */
export const Config: s<VideoWorkspaceConfig> = s.object({
  batchPollIntervalMs: s.number().step(1).min(100).max(60000).default(1500),
})

/**
 * Resolve and validate the workspace observation policy before creating controllers.
 * @param input - Deployment values passed by the Loader or a standalone controller owner.
 * @returns Complete validated observation cadence.
 */
export function resolveWorkspaceConfig(input: VideoWorkspaceConfig = {}): Required<VideoWorkspaceConfig> {
  return Config(input) as Required<VideoWorkspaceConfig>
}
