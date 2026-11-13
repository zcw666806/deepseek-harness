/** Stable Remote diagnostics for rejected manuscript operations. */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A project scope, revision, geometry, or media validation failed. */
    'comic-production/invalid': { readonly reason: string }
  }
}

/**
 * Reject a request without disclosing private paths or transport internals.
 * @param reason - stable validation identifier.
 * @param message - user-facing diagnostic.
 * @returns never because this operation always throws.
 */
export function failure(reason: string, message: string): never {
  throw new RemoteError('comic-production/invalid', message, { reason })
}
