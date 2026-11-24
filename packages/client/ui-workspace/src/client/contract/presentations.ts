/** Explicit feature-owned navigation metadata for Sessions with non-chat content. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** A feature's authoritative display title for a Session containing its own project data. */
export interface WorkspaceSessionPresentation {
  readonly sessionId: SessionId
  readonly displayTitle: string
}
