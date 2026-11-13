/** Host half of the video production workspace; presentation runs in the browser. */
import type { Context } from '@deepseek-ai/cordis'
import { resolveWorkspaceConfig, type VideoWorkspaceConfig } from './config.ts'
export { Config } from './config.ts'

/**
 * Validate the browser observation policy when the workspace plugin is mounted.
 * @param _ctx - Effect-owning Host context; this presentation plugin contributes no Host service.
 * @param config - Deployment cadence shared with the browser entry.
 */
export function apply(_ctx: Context, config: VideoWorkspaceConfig = {}): void { resolveWorkspaceConfig(config) }
