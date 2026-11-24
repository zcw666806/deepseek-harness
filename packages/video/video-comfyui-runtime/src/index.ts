/** Register local ComfyUI lifecycle management in DSH's capability center. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-capability-manager'
import { resolveConfig } from './config.ts'
import type { Config } from './types.ts'
import { ManagedComfyRuntime } from './runtime.ts'

export { Config } from './config.ts'
/** Function plugin identity. */
export const name = 'video-comfyui-runtime'
/** Capability registry and local execution services. */
export const inject = ['capabilities', 'subprocess', 'fs']
/**
 * Register bounded runtime management without starting or installing an engine.
 * @param ctx - Context with the capability registry and host execution services.
 * @param input - Machine-local bindings resolved independently from imported projects.
 */
export function apply(ctx: Context, input: Config): void {
  const runtime = new ManagedComfyRuntime(ctx, resolveConfig(input))
  const unregister = ctx.capabilities.register(runtime.provider())
  ctx.effect(() => async () => { await unregister(); await runtime.dispose() }, 'managed ComfyUI runtime')
}
