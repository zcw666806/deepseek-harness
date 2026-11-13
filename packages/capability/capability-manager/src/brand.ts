/** Construction of configured capability identities. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CapabilityId as Id } from './types.ts'

/**
 * Brand an installed provider's configured identity.
 * @param value - Provider-owned stable nonempty identifier.
 * @returns The capability identity.
 */
export function CapabilityId(value: string): Id {
  return brandString<Id>(value)
}
