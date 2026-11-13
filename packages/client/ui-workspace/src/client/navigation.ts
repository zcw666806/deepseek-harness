/** Workspace archive and directory UI capability. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ClientRemote, DirectoryListing, RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ISessions,
  SessionListState,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceSessionPresentation } from './contract/presentations.ts'
import { SessionPresentationDirectory } from './session-presentations.ts'

/**
 * Inspect feature-owned data before reusing a transcript-blank Session.
 * @param sessionId - candidate already belonging to the requested Workspace.
 * @returns true only when this feature permits reuse; rejection prevents reuse.
 */
export type SessionReuseGuard = (sessionId: SessionId) => boolean | Promise<boolean>

interface ReuseGuardEntry {
  readonly guard: SessionReuseGuard
  readonly pending: Set<Promise<boolean>>
  accepting: boolean
}

/** Workspace archive and directory operations consumed by Client UI domains. */
export interface UiWorkspace {
  /**
   * Register authoritative feature titles that keep project-bearing blank Sessions navigable.
   * @param source - Explicit feature-owned presentation projection, without modifying Session state.
   * @returns Effect-owned disposer withdrawing this source and its subscription.
   */
  registerSessionPresentation(source: ObservableSnapshot<readonly WorkspaceSessionPresentation[]>): () => void
  /**
   * Register a feature's check for data that a blank transcript does not describe.
   * @param guard - callback returning true only for reusable candidates.
   * @returns disposer withdrawing the guard and awaiting its admitted probes.
   */
  registerSessionReuseGuard(guard: SessionReuseGuard): () => Promise<void>
  /**
   * Resolve the reusable or newly created blank Session for a Workspace.
   * @param workspaceId - target Workspace.
   * @returns a Session already addressable through the Session Controller.
   */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  /**
   * Start a New Session flow and navigate to its Session.
   * @param workspaceId - explicit target; absent inherits the current or most recent Workspace.
   */
  startSession(workspaceId?: WorkspaceId): void
  /**
   * Archive a Session and clear it when it is the current selection.
   * @param sessionId - Session to archive.
   */
  archiveSession(sessionId: SessionId): Promise<void>
  /**
   * Open the Host-native directory picker.
   * @returns the selected directory, or null when cancelled.
   */
  pickDirectory(): Promise<string | null>
  /**
   * List one Host directory level.
   * @param path - directory path; absent selects the Host home.
   * @param signal - cancellation for a superseded scan.
   * @returns directory entries and breadcrumb ancestry.
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create a child directory.
   * @param path - existing parent directory.
   * @param name - child directory name.
   * @returns created absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-Controller Workspace navigation and directory UI capability. */
    uiWorkspace: UiWorkspace
  }
}

/** Structured directory failure exposed to directory UI consumers. */
export class DirectoryBrowseError extends Error {
  override readonly name = 'DirectoryBrowseError'

  /** @param rpcError - Host directory business failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Implements Workspace archive and directory UI operations. */
class UiWorkspaceService extends Service implements UiWorkspace {
  private readonly presentationDirectory = new SessionPresentationDirectory()
  /** Aggregated feature-owned Session titles supplied to the Workspace browser's injected hook. */
  readonly sessionPresentations = this.presentationDirectory.snapshot
  private readonly reuseGuards = new Set<ReuseGuardEntry>()
  private readonly connecting = new Map<WorkspaceId, Promise<SessionId>>()

  /**
   * @param ctx - Client root Context.
   * @param directoryPicker - the directory-picking Remote namespace.
   * @param workspaces - pure Workspace Controller.
   * @param sessions - pure Session Controller.
   */
  constructor(
    ctx: Context,
    private readonly directoryPicker: ClientRemote['directoryPicker'],
    private readonly workspaces: IWorkspaces,
    private readonly sessions: ISessions,
  ) {
    super(ctx, 'uiWorkspace')
    ctx.effect(() => () => { this.presentationDirectory.clear() }, 'ui-workspace: Session presentations')
    ctx.effect(() => this.watchNavigation(), 'ui-workspace: Workspace navigation policy')
  }

  registerSessionPresentation(source: ObservableSnapshot<readonly WorkspaceSessionPresentation[]>): () => void {
    const dispose = this.ctx.effect(() => this.presentationDirectory.register(source), 'ui-workspace: feature Session presentation')
    return () => { void dispose() }
  }

  registerSessionReuseGuard(guard: SessionReuseGuard): () => Promise<void> {
    const entry: ReuseGuardEntry = { guard, pending: new Set(), accepting: true }
    const dispose = this.ctx.effect(() => {
      this.reuseGuards.add(entry)
      return async () => {
        entry.accepting = false
        this.reuseGuards.delete(entry)
        await Promise.allSettled([...entry.pending])
      }
    }, 'ui-workspace: Session reuse guard')
    return async () => { await dispose() }
  }

  async connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId> {
    const workspace = this.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) {
      throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
    }
    const inflight = this.connecting.get(workspaceId)
    if (inflight !== undefined) return inflight

    const attempt = this.resolveSession(workspace)
      .finally(() => { this.connecting.delete(workspaceId) })
    this.connecting.set(workspaceId, attempt)
    return attempt
  }

  private async resolveSession(workspace: WorkspaceView): Promise<SessionId> {
    for (const id of this.sessions.list.getSnapshot().ids) {
      if (this.isBlankCandidate(workspace.workspaceId, id) && await this.canReuse(id)
        && this.isBlankCandidate(workspace.workspaceId, id)) return id
    }
    return await this.sessions.create({ workspaceId: workspace.workspaceId })
  }

  private isBlankCandidate(workspaceId: WorkspaceId, sessionId: SessionId): boolean {
    const workspaces = this.workspaces.list.getSnapshot()
    const workspace = workspaces.items.find(item => item.workspaceId === workspaceId)
    const summary = this.sessions.list.getSnapshot().byId[sessionId]
    return workspace !== undefined && summary !== undefined && summary.blank && summary.cwd === workspace.path
      && workspace.sessionIds.includes(sessionId) && !workspaces.archivedSessionIds.includes(sessionId)
  }

  private async canReuse(sessionId: SessionId): Promise<boolean> {
    for (const entry of this.reuseGuards) {
      const result = Promise.resolve().then(() => entry.accepting ? entry.guard(sessionId) : false)
      entry.pending.add(result)
      try {
        if (!await result || !entry.accepting) return false
      } catch {
        return false
      } finally {
        entry.pending.delete(result)
      }
    }
    return true
  }

  startSession(workspaceId?: WorkspaceId): void {
    const workspace = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const current = sessions.current
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
    const recent = workspace.phase === 'ready' && sessions.phase === 'ready'
      ? recentWorkspace(workspace.items, sessions.byId)
      : undefined
    const target = workspaceId ?? currentWorkspaceId ?? recent
    if (target === undefined) {
      this.sessions.clear()
      return
    }
    void this.connectWorkspace(target).then(
      (sessionId) => { this.sessions.open(sessionId) },
      (reason: unknown) => { console.warn('new session failed:', reason) },
    )
  }

  async archiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.archiveSession(sessionId)
  }

  async pickDirectory(): Promise<string | null> {
    const result = await this.directoryPicker.pick()
    if (!result.ok) throw new Error(`directory picker failed: ${result.error.message}`)
    return result.value
  }

  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const result = await this.directoryPicker.list(path, signal)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  async createDirectory(path: string, name: string): Promise<string> {
    const result = await this.directoryPicker.createDirectory(path, name)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  private watchNavigation(): () => void {
    let initial: 'waiting' | 'connecting' | 'done' = 'waiting'
    let disposed = false
    const reconcile = (): void => {
      if (disposed) return
      if (this.clearArchivedCurrent()) return
      if (initial !== 'waiting') return
      const workspace = this.workspaces.list.getSnapshot()
      const sessions = this.sessions.list.getSnapshot()
      if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return
      if (sessions.current !== undefined) {
        initial = 'done'
        return
      }
      const target = recentWorkspace(workspace.items, sessions.byId)
      if (target === undefined) {
        initial = 'done'
        return
      }
      initial = 'connecting'
      void this.connectWorkspace(target).then(
        (sessionId) => {
          if (disposed) return
          if (this.sessions.list.getSnapshot().current === undefined) {
            this.sessions.open(sessionId)
          }
          initial = 'done'
        },
        (reason: unknown) => {
          if (disposed) return
          initial = 'waiting'
          console.warn('initial workspace selection failed:', reason)
        },
      )
    }
    const disposeWorkspaces = this.workspaces.list.subscribe(reconcile)
    const disposeSessions = this.sessions.list.subscribe(reconcile)
    reconcile()
    return () => {
      disposed = true
      disposeSessions()
      disposeWorkspaces()
    }
  }

  /** @returns true when an archived current selection was cleared. */
  private clearArchivedCurrent(): boolean {
    const current = this.sessions.list.getSnapshot().current
    if (current === undefined
      || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) return false
    this.sessions.clear()
    return true
  }

}

/** Stable tie-breaking follows Host Workspace order. */
function recentWorkspace(
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState['byId'],
): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = sessions[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

export { UiWorkspaceService }
