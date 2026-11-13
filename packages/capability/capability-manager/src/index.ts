/** Effect-owned capability directory and serialized fixed-action management. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { z } from 'zod'
import s from '@deepseek-ai/schemastery'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { parsePortableCapabilityManifest } from './portable.ts'
import type {
  CapabilityAction, CapabilityHealth, CapabilityId, CapabilityProvider, CapabilityRestorePlan, CapabilityRestorePlanItem,
  CapabilityRestoreResult, CapabilityView,
  Config, PortableCapability, PortableCapabilityManifest,
} from './types.ts'

export type * from './types.ts'
export { CapabilityId } from './brand.ts'
export { parsePortableCapabilityManifest } from './portable.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Installed capability providers and their fixed management operations. */
    capabilities: CapabilityManager
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Management admission failure with a stable domain-specific reason. */
    'capabilities/invalid': { readonly reason: string }
  }
}

interface Entry {
  readonly provider: CapabilityProvider
  readonly lifetime: AbortController
  tail: Promise<void>
  accepting: boolean
}

const identity = z.string().trim().min(1).max(256)
const actionSchema = z.enum(['check', 'prepare', 'start', 'stop'])

function failure(reason: string, message: string): never {
  throw new RemoteError('capabilities/invalid', message, { reason })
}

function actions(provider: CapabilityProvider): CapabilityAction[] {
  return ['check', ...provider.prepare === undefined ? [] : ['prepare' as const],
    ...provider.start === undefined ? [] : ['start' as const], ...provider.stop === undefined ? [] : ['stop' as const]]
}

/** Capability directory shared by the Web management UI and installed engine providers. */
export class CapabilityManager extends TypertRemoteService {
  /** Loader validation for management operation deadlines and output limits. */
  static Config: s<Config> = s.object({
    maxProviders: s.number().step(1).min(1).max(256).default(64),
    checkTimeoutMs: s.number().step(1).min(1).max(2_147_483_647).default(10_000),
    actionTimeoutMs: s.number().step(1).min(1).max(2_147_483_647).default(300_000),
    maxResultBytes: s.number().step(1).min(1024).max(16_777_216).default(1_048_576),
  })

  private readonly config: Required<Config>
  private readonly entries = new Map<CapabilityId, Entry>()
  private closing = false

  /** @param ctx - Effect-owning context. @param config - Provider, operation, and response bounds. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'capabilities')
    // The schema materializes every default above; its generic still describes optional operator inputs.
    this.config = CapabilityManager.Config(config) as Required<Config>
  }

  /** Stop accepting work and await every registered provider operation during unload. */
  protected [Service.init](): void {
    this.ctx.effect(() => async () => {
      this.closing = true
      await Promise.all([...this.entries.values()].map(entry => this.retire(entry)))
    }, 'capability management operations')
  }

  /**
   * Register an installed implementation; its callbacks retain process and credential ownership.
   * @param provider - Typed installed provider whose inspections contain only public diagnostics.
   * @returns Async disposer removing this registration, cancelling its operations, and awaiting settlement.
   */
  register(provider: CapabilityProvider): () => Promise<void> {
    if (this.closing) failure('unavailable', 'Capability management is unloading.')
    const id = provider.descriptor.id
    if (id.trim().length === 0 || this.entries.has(id)) failure('identity-invalid', 'Capability identity is empty or already registered.')
    if (this.entries.size >= this.config.maxProviders) failure('limit', 'Capability management has reached maxProviders.')
    const entry: Entry = { provider, lifetime: new AbortController(), tail: Promise.resolve(), accepting: true }
    const dispose = this.ctx.effect(() => {
      this.entries.set(id, entry)
      return () => this.retire(entry)
    }, `capability ${id}`)
    return async () => { await dispose() }
  }

  /**
   * Inspect every current installed capability without installing or starting it.
   * @param signal - Caller cancellation; each inspection also observes checkTimeoutMs.
   * @returns Current descriptions, actual callback-derived actions, and safe readiness observations.
   */
  @Remote('list')
  async list(signal: AbortSignal): Promise<readonly CapabilityView[]> {
    if (this.closing) failure('unavailable', 'Capability management is unloading.')
    const entries = [...this.entries.values()]
    const result = await Promise.all(entries.map(entry => this.enqueue(entry, 'check', signal)))
    return this.bounded(result)
  }

  /**
   * Execute one fixed operation through its current installed provider, serialized per capability.
   * @param id - Current registered capability identity.
   * @param action - Check, prepare, start, or stop; unsupported operations reject before provider invocation.
   * @param signal - Caller cancellation and configured complete-operation deadline.
   * @returns Post-operation inspection, or a safe error view when provider work fails.
   */
  @Remote('perform')
  async perform(id: CapabilityId, action: CapabilityAction, signal: AbortSignal): Promise<CapabilityView> {
    identity.parse(id)
    const selected = actionSchema.parse(action)
    if (this.closing) failure('unavailable', 'Capability management is unloading.')
    const entry = this.entries.get(id)
    if (entry === undefined) failure('not-found', 'The requested capability is not registered.')
    if (!actions(entry.provider).includes(selected)) failure('unsupported', 'The capability does not provide this operation.')
    return this.bounded(await this.enqueue(entry, selected, signal))
  }

  /**
   * Export current engine requirements and provider-declared portable configuration.
   * @param signal - Caller cancellation; each provider read has the inspection deadline.
   * @returns A bounded manifest without runtime commands, environments, weights, or implicit credential copying.
   */
  @Remote('exportManifest')
  async exportManifest(signal: AbortSignal): Promise<PortableCapabilityManifest> {
    if (this.closing) failure('unavailable', 'Capability management is unloading.')
    const capabilities = await Promise.all([...this.entries.values()].map(entry =>
      this.run(entry, signal, this.config.checkTimeoutMs, async (active): Promise<PortableCapability> => {
        const { id, engineId, version } = entry.provider.descriptor
        let configuration: JsonValue | undefined
        try {
          configuration = await entry.provider.exportConfiguration?.(active)
        } catch {
          active.throwIfAborted()
          failure('export-failed', 'The capability could not export its portable settings.')
        }
        active.throwIfAborted()
        return { id, engineId, ...version === undefined ? {} : { version },
          ...configuration === undefined ? {} : { configuration } }
      })))
    return this.bounded({ format: 'dsh-capabilities', version: 1, capabilities })
  }

  /**
   * Preview installed engine compatibility and current prerequisites without changing target-machine state.
   * @param manifest - Complete untrusted portable manifest, validated before any provider inspection.
   * @param signal - Caller cancellation; each inspection includes its configured queue and execution deadline.
   * @returns Credential-free compatibility results; pending settings still require explicit provider validation during restoration.
   */
  @Remote('planRestore')
  async planRestore(manifest: PortableCapabilityManifest, signal: AbortSignal): Promise<CapabilityRestorePlan> {
    const parsed = this.imported(manifest)
    const items: CapabilityRestorePlanItem[] = []
    for (const item of parsed.capabilities) {
      signal.throwIfAborted()
      const entry = this.entries.get(item.id)
      const expected = { id: item.id, expectedEngineId: item.engineId,
        ...item.version === undefined ? {} : { expectedVersion: item.version } }
      const configuration = item.configuration === undefined ? 'none' as const : 'pending-validation' as const
      if (entry === undefined) {
        items.push({ ...expected, status: 'missing', configuration,
          message: 'The required capability must be installed and configured on the target machine.' })
        continue
      }
      const current = await this.enqueue(entry, 'check', signal)
      const mismatch = current.engineId !== item.engineId || (item.version !== undefined && current.version !== item.version)
      const unsupported = item.configuration !== undefined && entry.provider.restoreConfiguration === undefined
      items.push({ ...expected, current, status: mismatch || unsupported ? 'unsupported' : 'compatible',
        configuration: unsupported ? 'unsupported' : configuration,
        ...mismatch ? { message: 'The installed engine or version does not match.' }
          : unsupported ? { message: 'The capability does not accept portable settings.' } : {} })
    }
    return this.bounded({ items })
  }

  /**
   * Restore matching installed providers' declarative settings; no runtime is installed or started.
   * @param manifest - Untrusted complete portable manifest; invalid or duplicate entries reject before any callback.
   * @param signal - Caller cancellation; each provider restore has the configured action deadline.
   * @returns Per-provider results. Missing engines and version mismatches remain explicit; independent restores can partially succeed.
   */
  @Remote('restoreManifest')
  async restoreManifest(manifest: PortableCapabilityManifest, signal: AbortSignal): Promise<readonly CapabilityRestoreResult[]> {
    const parsed = this.imported(manifest)
    const results: CapabilityRestoreResult[] = []
    for (const item of parsed.capabilities) {
      signal.throwIfAborted()
      const entry = this.entries.get(item.id)
      if (entry === undefined) {
        results.push({ id: item.id, status: 'missing', message: 'The required capability is not installed.' })
      } else if (entry.provider.descriptor.engineId !== item.engineId
        || (item.version !== undefined && entry.provider.descriptor.version !== item.version)) {
        results.push({ id: item.id, status: 'unsupported', message: 'The installed engine or version does not match.' })
      } else if (item.configuration !== undefined && entry.provider.restoreConfiguration === undefined) {
        results.push({ id: item.id, status: 'unsupported', message: 'The capability does not accept portable settings.' })
      } else {
        const result = await this.run(entry, signal, this.config.actionTimeoutMs, async (active): Promise<CapabilityRestoreResult> => {
          try {
            if (item.configuration !== undefined) await entry.provider.restoreConfiguration?.(item.configuration, active)
            active.throwIfAborted()
            return { id: item.id, status: 'restored' }
          } catch {
            active.throwIfAborted()
            return { id: item.id, status: 'failed', message: 'The capability rejected its imported settings.' }
          }
        })
        results.push(result)
      }
    }
    return this.bounded(results)
  }

  private imported(manifest: PortableCapabilityManifest): PortableCapabilityManifest {
    if (this.closing) failure('unavailable', 'Capability management is unloading.')
    const parsed = parsePortableCapabilityManifest(this.bounded(manifest))
    if (parsed.capabilities.length > this.config.maxProviders) failure('manifest-invalid', 'Capability manifest exceeds maxProviders.')
    return parsed
  }

  private bounded<T>(value: T): T {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > this.config.maxResultBytes) {
      failure('result-too-large', 'The complete capability result exceeds maxResultBytes.')
    }
    return value
  }

  private async retire(entry: Entry): Promise<void> {
    entry.accepting = false
    if (this.entries.get(entry.provider.descriptor.id) === entry) this.entries.delete(entry.provider.descriptor.id)
    entry.lifetime.abort(new Error('The capability provider was removed.'))
    await entry.tail
  }

  private async enqueue(entry: Entry, action: CapabilityAction, caller: AbortSignal): Promise<CapabilityView> {
    return this.run(entry, caller, action === 'check' ? this.config.checkTimeoutMs : this.config.actionTimeoutMs, async (active) => {
      try {
        if (action !== 'check') {
          const callback = entry.provider[action]
          if (callback === undefined) failure('unsupported', 'The capability does not provide this operation.')
          await callback.call(entry.provider, active)
          active.throwIfAborted()
        }
        using inspection = deadline(active, action === 'check' ? 0 : this.config.checkTimeoutMs, 'CAPABILITY_CHECK_TIMEOUT')
        const health = await entry.provider.inspect(inspection.signal)
        inspection.signal.throwIfAborted()
        return this.view(entry, health)
      } catch {
        active.throwIfAborted()
        return this.view(entry, { status: 'error', requirements: [], message: `Capability ${action} failed.` })
      }
    })
  }

  private async run<T>(entry: Entry, caller: AbortSignal, timeoutMs: number, callback: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!entry.accepting) failure('unavailable', 'The capability provider was removed.')
    using operation = deadline(AbortSignal.any([caller, entry.lifetime.signal]), timeoutMs, 'CAPABILITY_TIMEOUT')
    const result = entry.tail.then(() => {
      operation.signal.throwIfAborted()
      return callback(operation.signal)
    })
    entry.tail = result.then(() => undefined, () => undefined)
    return await result
  }

  private view(entry: Entry, health: CapabilityHealth): CapabilityView {
    return { ...entry.provider.descriptor, ...health, actions: actions(entry.provider) }
  }
}

export default CapabilityManager
