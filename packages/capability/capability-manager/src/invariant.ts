/** Invariant companion for the capability registration and operation owner. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis companion identity. */
export const name = 'capability-manager-invariant'
/** Required invariant registry. */
export const inject = ['invariants']

/**
 * No runtime invariant: registered provider lifetimes and pending operations are private;
 * the manager owns admission and settlement, while each provider owns observable runtime health.
 */
const install: InvariantInstaller = () => {}

/** @param ctx - Context with invariant registration. @returns The companion registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-capability-manager', install))
