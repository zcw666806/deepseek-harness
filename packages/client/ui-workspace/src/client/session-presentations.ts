/** Aggregate feature-owned Session presentation sources without changing Session metadata. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceSessionPresentation } from './contract/presentations.ts'

interface Entry {
  readonly source: ObservableSnapshot<readonly WorkspaceSessionPresentation[]>
  readonly unsubscribe: () => void
}

/** Owns registration order, source subscriptions, and one stable read-only aggregate. */
export class SessionPresentationDirectory {
  private readonly source = createSnapshotStore<readonly WorkspaceSessionPresentation[]>([])
  private readonly entries = new Set<Entry>()
  /** Stable read-only projection; duplicate Session identities use the first registered source's title. */
  readonly snapshot: ObservableSnapshot<readonly WorkspaceSessionPresentation[]> = this.source

  /**
   * Register an explicit feature projection; the first registered source wins duplicate titles.
   * @param source - Authoritative feature-owned Session presentation snapshot.
   * @returns Idempotent disposer removing its rows and subscription synchronously.
   */
  register(source: ObservableSnapshot<readonly WorkspaceSessionPresentation[]>): () => void {
    const entry: Entry = { source, unsubscribe: source.subscribe(() => { this.refresh() }) }
    this.entries.add(entry)
    this.refresh()
    return () => {
      if (!this.entries.delete(entry)) return
      entry.unsubscribe()
      this.refresh()
    }
  }

  /** Remove every source and publish the empty aggregate during owner teardown. */
  clear(): void {
    const entries = [...this.entries]
    this.entries.clear()
    for (const entry of entries) entry.unsubscribe()
    this.refresh()
  }

  private refresh(): void {
    const rows = new Map<SessionId, WorkspaceSessionPresentation>()
    for (const entry of this.entries) {
      for (const item of entry.source.getSnapshot()) {
        if (!rows.has(item.sessionId)) rows.set(item.sessionId, item)
      }
    }
    const next = [...rows.values()]
    const current = this.source.getSnapshot()
    if (next.length === current.length && next.every((item, index) => {
      const prior = current.at(index)
      return prior !== undefined && item.sessionId === prior.sessionId && item.displayTitle === prior.displayTitle
    })) return
    this.source.set(next)
  }
}
