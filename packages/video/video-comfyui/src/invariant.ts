/** Invariant companion for the stateless ComfyUI HTTP provider. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis companion identity. */
export const name = 'video-comfyui-invariant'
/** Required invariant registry. */
export const inject = ['invariants']

/**
 * No runtime invariant: this provider retains no shared product state;
 * video-production owns durable attempts and attachment relationships.
 */
const install: InvariantInstaller = () => {}

/** @param ctx - Context with invariant registration. @returns Companion registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-video-comfyui', install))
