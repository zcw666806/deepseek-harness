/** Provider-owned capability descriptions and credential-free runtime health. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Stable identity contributed by one installed capability provider. */
export type CapabilityId = Branded<'CapabilityId'>

/** Fixed management operations; callers cannot provide executable commands. */
export type CapabilityAction = 'check' | 'prepare' | 'start' | 'stop'

/** User-visible identity of an installed capability provider. */
export interface CapabilityDescriptor {
  readonly id: CapabilityId
  readonly title: string
  readonly description: string
  readonly category: string
  readonly engineId: string
  readonly version?: string
  readonly kind: 'local' | 'remote'
}

/** One provider-inspected prerequisite, without secret values or executable configuration. */
export interface CapabilityRequirement {
  readonly id: string
  readonly title: string
  readonly status: 'available' | 'missing' | 'unsupported'
  readonly message?: string
}

/** Current provider observations; diagnostics must be safe for the management UI. */
export interface CapabilityHealth {
  readonly status: 'ready' | 'stopped' | 'missing' | 'unavailable' | 'error'
  readonly message?: string
  readonly requirements: readonly CapabilityRequirement[]
  readonly owned?: boolean
}

/** Public description and latest inspection, with operations derived from actual provider callbacks. */
export interface CapabilityView extends CapabilityDescriptor, CapabilityHealth {
  readonly actions: readonly CapabilityAction[]
}

/** Installed implementation owning its runtime and any child processes it starts. */
export interface CapabilityProvider {
  readonly descriptor: CapabilityDescriptor
  /**
   * Inspect actual prerequisites and runtime readiness without exposing secrets.
   * @param signal - Combined caller, registration, service, and inspection deadline cancellation.
   * @returns Current safe user-facing observations.
   */
  inspect(signal: AbortSignal): Promise<CapabilityHealth>
  /**
   * Prepare this provider's explicitly configured environment, without accepting caller commands.
   * @param signal - Cancellation and the configured action deadline.
   * @returns When preparation and owned work have settled.
   */
  prepare?(signal: AbortSignal): Promise<void>
  /**
   * Start or connect this provider's configured runtime.
   * @param signal - Cancellation and the configured action deadline.
   * @returns When startup has settled; readiness is checked separately.
   */
  start?(signal: AbortSignal): Promise<void>
  /**
   * Stop only runtime processes owned by this provider.
   * @param signal - Cancellation and the configured action deadline.
   * @returns When owned work has stopped, rather than merely receiving a stop request.
   */
  stop?(signal: AbortSignal): Promise<void>
  /**
   * Export declarative settings without credentials, host paths, or executable instructions.
   * @param signal - Cancellation and the configured inspection deadline.
   * @returns Portable provider-owned settings; runtime environments and model weights are excluded.
   */
  exportConfiguration?(signal: AbortSignal): Promise<JsonValue>
  /**
   * Validate and restore declarative settings without preparing or starting a runtime.
   * @param configuration - Untrusted imported JSON to validate before changing provider settings.
   * @param signal - Cancellation and the configured action deadline.
   * @returns When settings have committed or rejected without a partial provider update.
   */
  restoreConfiguration?(configuration: JsonValue, signal: AbortSignal): Promise<void>
}

/** Portable requirement and optional explicitly exported provider settings. */
export interface PortableCapability {
  readonly id: CapabilityId
  readonly engineId: string
  readonly version?: string
  readonly configuration?: JsonValue
}

/** Versioned declarative capability inventory; it contains no executable installation recipes. */
export interface PortableCapabilityManifest {
  readonly format: 'dsh-capabilities'
  readonly version: 1
  readonly capabilities: readonly PortableCapability[]
}

/** One explicit configuration restoration outcome; ready runtime state is inspected separately. */
export interface CapabilityRestoreResult {
  readonly id: CapabilityId
  readonly status: 'restored' | 'missing' | 'unsupported' | 'failed'
  readonly message?: string
}

/** Read-only target-machine compatibility and readiness for one imported capability. */
export interface CapabilityRestorePlanItem {
  readonly id: CapabilityId
  readonly expectedEngineId: string
  readonly expectedVersion?: string
  readonly status: 'compatible' | 'missing' | 'unsupported'
  /** Imported settings are validated only by an explicit restore, never by this compatibility inspection. */
  readonly configuration: 'none' | 'pending-validation' | 'unsupported'
  readonly current?: CapabilityView
  readonly message?: string
}

/** Recovery preview without applying settings, preparing environments, or starting engines. */
export interface CapabilityRestorePlan {
  readonly items: readonly CapabilityRestorePlanItem[]
}

/** Deployment bounds for registered providers and their management operations. */
export interface Config {
  /** Maximum simultaneously registered providers; integer 1–256, default 64. */
  readonly maxProviders?: number
  /** Inspection deadline including queue wait; integer 1–2,147,483,647 milliseconds, default 10,000. */
  readonly checkTimeoutMs?: number
  /** Prepare/start/stop deadline including queue wait and final inspection; integer 1–2,147,483,647 milliseconds, default 300,000. */
  readonly actionTimeoutMs?: number
  /** Maximum UTF-8 JSON bytes in a complete returned view or list; integer 1,024–16,777,216, default 1,048,576. */
  readonly maxResultBytes?: number
}
