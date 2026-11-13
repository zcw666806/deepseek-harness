/** Package-owned invariant registration for manuscript revisions and original PNG references. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis companion plugin name. */
export const name = 'comic-production-invariant'
/** Required invariant registry. */
export const inject = ['invariants']

/**
 * No runtime invariant: the owning writer validates geometry and retained artwork
 * references before each atomic revision, and the durable parser checks them at open.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['comicProduction'] })

/** @param ctx - context carrying the invariant registry. @returns the companion registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-comic-production', install))
