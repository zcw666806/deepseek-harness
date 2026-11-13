/** Staged REA launch settings applied to newly created chats. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CardShell } from './card-form.ts'

/** Namespace registered by the Host REA experiment. */
export const REA_EXPERIMENT_NS = 'rea-experiment'

/** Host-resolved REA launch settings. */
export interface ReaExperimentSettings {
  enabled: boolean
  command: string
  args: string[]
  toolCallTimeoutMs: number
}

/** Advanced setting addressed by a text control. */
export type ReaExperimentField = 'command' | 'args' | 'toolCallTimeoutMs'

interface Draft {
  enabled: boolean
  command: string
  args: string
  toolCallTimeoutMs: string
  revision: number | undefined
}

/** State rendered by the REA experiment card. */
export interface ReaExperimentCardState extends CardShell {
  enabled: boolean
  command: string
  args: string
  toolCallTimeoutMs: string
  commandInvalid: boolean
  argsInvalid: boolean
  timeoutInvalid: boolean
  conflicted: boolean
}

/** Snapshot and staged actions injected into the REA card. */
export interface ReaExperimentCardFace {
  hooks: {
    reaExperimentCard: SnapshotStore<ReaExperimentCardState>
  }
  /** Stage enablement; disabling discards advanced drafts. */
  toggleEnabled: () => void
  /** Stage one advanced field while the experiment is enabled. */
  edit: (field: ReaExperimentField, text: string) => void
  /** Persist the draft as one revision-fenced mutation. */
  save: () => void
  /** Restore the current Host values without writing. */
  discard: () => void
}

function parseArgs(text: string): string[] | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  return Array.isArray(value) && value.every((arg): arg is string => typeof arg === 'string' && !arg.includes('\0'))
    ? value
    : undefined
}

function parseTimeout(text: string): number | undefined {
  if (text.trim() === '') return undefined
  const value = Number(text)
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647 ? value : undefined
}

function sameSettings(left: ReaExperimentSettings, right: ReaExperimentSettings): boolean {
  return left.enabled === right.enabled && left.command === right.command
    && left.toolCallTimeoutMs === right.toolCallTimeoutMs
    && left.args.length === right.args.length && left.args.every((arg, index) => arg === right.args[index])
}

/** Owns staged settings and suppresses settlements from an earlier connection. */
export class ReaExperimentCardController {
  private draft: Draft | undefined
  private saving = false
  private failed = false
  private conflicted = false
  private disposed = false
  private generation = 0
  private readonly store: SnapshotStore<ReaExperimentCardState>
  private readonly unsubscribe: () => void

  /** @param scope - Bound `rea-experiment` settings scope. */
  constructor(private readonly scope: SettingsScope<ReaExperimentSettings>) {
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = scope.subscribe(() => {
      if (this.disposed) return
      if (!this.saving && this.draft !== undefined && scope.getSnapshot().revision !== this.draft.revision) {
        const current = scope.getSnapshot().value
        const desired = this.desired()
        if (current !== undefined && desired !== undefined && sameSettings(current, desired)) this.clearDraft()
        else this.conflicted = true
      }
      this.publish()
    })
  }

  /** Stop observing settings and ignore outstanding write settlements. */
  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.unsubscribe()
  }

  /** Drop drafts and outstanding write state after a connection reset. */
  resetConnection(): void {
    if (this.disposed) return
    this.generation += 1
    this.saving = false
    this.clearDraft()
    this.publish()
  }

  /**
   * Build the renderer face for the REA experiment card.
   * @returns The snapshot and actions bound by the slot renderer.
   */
  inject(): ReaExperimentCardFace {
    return {
      hooks: { reaExperimentCard: this.store },
      toggleEnabled: () => { this.toggleEnabled() },
      edit: (field, text) => { this.edit(field, text) },
      save: () => { void this.save() },
      discard: () => {
        if (!this.disposed && !this.saving) {
          this.clearDraft()
          this.publish()
        }
      },
    }
  }

  private writable(): boolean {
    const snapshot = this.scope.getSnapshot()
    return !this.disposed && !this.saving && snapshot.status === 'ready' && snapshot.writable
  }

  private currentDraft(): Draft | undefined {
    const snapshot = this.scope.getSnapshot()
    const current = snapshot.value
    return current === undefined ? undefined : {
      enabled: current.enabled,
      command: current.command,
      args: JSON.stringify(current.args),
      toolCallTimeoutMs: String(current.toolCallTimeoutMs),
      revision: snapshot.revision,
    }
  }

  private toggleEnabled(): void {
    if (!this.writable()) return
    const enabled = !(this.draft?.enabled ?? this.scope.getSnapshot().value?.enabled ?? false)
    if (!enabled || this.draft === undefined) this.draft = this.currentDraft()
    if (this.draft === undefined) return
    this.draft.enabled = enabled
    this.failed = false
    if (!enabled) this.conflicted = false
    this.publish()
  }

  private edit(field: ReaExperimentField, text: string): void {
    if (!this.writable() || !(this.draft?.enabled ?? this.scope.getSnapshot().value?.enabled)) return
    this.draft ??= this.currentDraft()
    if (this.draft === undefined) return
    this.draft[field] = text
    this.failed = false
    this.publish()
  }

  private desired(): ReaExperimentSettings | undefined {
    const current = this.scope.getSnapshot().value
    if (current === undefined || this.draft === undefined) return current
    if (!this.draft.enabled) return { ...current, enabled: false }
    const command = this.draft.command.trim()
    const args = parseArgs(this.draft.args)
    const toolCallTimeoutMs = parseTimeout(this.draft.toolCallTimeoutMs)
    if (command === '' || command.includes('\0') || args === undefined || toolCallTimeoutMs === undefined) return undefined
    return { enabled: true, command, args, toolCallTimeoutMs }
  }

  private clearDraft(): void {
    this.draft = undefined
    this.failed = false
    this.conflicted = false
  }

  private async save(): Promise<void> {
    if (!this.writable() || this.draft === undefined || !this.projection().dirty) return
    const desired = this.desired()
    if (desired === undefined) return
    if (this.scope.getSnapshot().revision !== this.draft.revision) {
      this.conflicted = true
      this.publish()
      return
    }
    const generation = this.generation
    this.saving = true
    this.failed = false
    this.publish()
    try {
      await this.scope.mutate([
        { op: 'set', path: ['enabled'], value: desired.enabled },
        ...desired.enabled ? [
          { op: 'set' as const, path: ['command'], value: desired.command },
          { op: 'set' as const, path: ['args'], value: desired.args },
          { op: 'set' as const, path: ['toolCallTimeoutMs'], value: desired.toolCallTimeoutMs },
        ] : [],
      ], this.draft.revision)
    } catch {
      if (generation !== this.generation) return
      this.saving = false
      this.failed = true
      this.publish()
      return
    }
    if (generation !== this.generation) return
    const current = this.scope.getSnapshot().value
    const landed = current !== undefined && (desired.enabled ? sameSettings(current, desired) : !current.enabled)
    this.saving = false
    this.failed = !landed
    if (landed) this.clearDraft()
    else this.conflicted = this.scope.getSnapshot().revision !== this.draft.revision
    this.publish()
  }

  private projection(): ReaExperimentCardState {
    const snapshot = this.scope.getSnapshot()
    const fields = this.draft ?? this.currentDraft()
    const enabled = fields?.enabled ?? false
    const command = fields?.command ?? ''
    const args = fields?.args ?? ''
    const toolCallTimeoutMs = fields?.toolCallTimeoutMs ?? ''
    const desired = this.desired()
    const current = snapshot.value
    const commandInvalid = enabled && (command.trim() === '' || command.includes('\0'))
    const argsInvalid = enabled && parseArgs(args) === undefined
    const timeoutInvalid = enabled && parseTimeout(toolCallTimeoutMs) === undefined
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.draft !== undefined && (desired === undefined || current === undefined || !sameSettings(current, desired)),
      invalid: commandInvalid || argsInvalid || timeoutInvalid || this.conflicted,
      saving: this.saving,
      failed: this.failed,
      enabled,
      command,
      args,
      toolCallTimeoutMs,
      commandInvalid,
      argsInvalid,
      timeoutInvalid,
      conflicted: this.conflicted,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}
