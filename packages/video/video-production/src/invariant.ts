/** Package-owned invariant registration for durable video projects. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis companion plugin name. */
export const name = 'video-production-invariant'
/** Required invariant registry. */
export const inject = ['invariants']

/**
 * No runtime invariant: one private typed writer commits each complete project;
 * durable schemas and write-time checks own its internal references and bounds.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['videoProduction'] })

/** @param ctx - context carrying the invariant registry. @returns the companion registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-video-production', install))
