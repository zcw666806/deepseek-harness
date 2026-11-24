/** Browser entry for the global capability-management settings section. */
import type { Context } from '@deepseek-ai/cordis'
import { mountCapabilities } from './mount.ts'
export { inject } from './mount.ts'

/**
 * Contribute capability management to the existing settings navigation.
 * @param ctx - browser plugin context.
 * @returns asynchronous registration disposer.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountCapabilities(ctx)
}
