/** Invariant companion for the comic workspace view. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis plugin identity for the invariant companion. */
export const name = 'client-ui-comic-production-invariant'
/** Registry that owns the companion registration. */
export const inject = ['invariants']

/** No runtime invariant: the view holds private drafts and the Host validates all committed page and layer relationships. */
const install: InvariantInstaller = () => {}

/**
 * Register the browser package companion.
 * @param ctx - Context with the invariant registry.
 * @returns The registration disposer after installation.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-client-ui-comic-production', install))
