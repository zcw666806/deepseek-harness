/** Invariant companion for operator-owned local process supervision. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Companion plugin identity. */
export const name = 'video-comfyui-runtime-invariant'
/** Required invariant registry. */
export const inject = ['invariants']
/** No runtime invariant: subprocess owns process-tree liveness; capabilities owns registration admission and settlement. */
const install: InvariantInstaller = () => {}
/** @param ctx - Context providing invariant registration. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-video-comfyui-runtime', install))
