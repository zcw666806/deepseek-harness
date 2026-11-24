/** Machine-local bindings and bounds for a replaceable managed ComfyUI installation. */
export interface Config {
  /** Runtime directory; relative paths resolve against the invoking directory, omission uses DSH_HOME/runtimes/comfyui. */
  readonly directory?: string
  /** Existing base Python executable or PATH name; default python, resolved by the configured subprocess provider. */
  readonly pythonPath?: string
  /** Local cache with the reviewed manifest, source archive, wheels and version lock; absent disables preparation. */
  readonly artifactDirectory?: string
  /** Basename of the artifact manifest in artifactDirectory; default manifest.json. */
  readonly manifestName?: string
  /** Exact SHA-256 of the reviewed manifest; required with artifactDirectory and never supplied by a project import. */
  readonly manifestSha256?: string
  /** Expected installed ComfyUI version, default 0.43.0; the runtime probe must agree before reporting ready. */
  readonly version?: string
  /** IPv4 loopback listener port; integer 1–65535, default 8188. */
  readonly port?: number
  /** Maximum startup readiness wait in milliseconds; integer 1–2147483647, default 120000. */
  readonly startupTimeoutMs?: number
  /** Milliseconds between readiness checks; integer 1–2147483647, default 500. */
  readonly pollIntervalMs?: number
  /** Managed process-tree termination grace in milliseconds; integer 1–2147483647, default 2000. */
  readonly processGraceMs?: number
  /** Maximum collected process bytes per output stream; integer 1–1048576, default 16384. */
  readonly maxProcessOutputBytes?: number
  /** Maximum JSON bytes from the loopback health endpoint; integer 1–1048576, default 65536. */
  readonly maxHealthBytes?: number
  /** Maximum health request duration in milliseconds; integer 1–2147483647, default 3000. */
  readonly healthTimeoutMs?: number
}
