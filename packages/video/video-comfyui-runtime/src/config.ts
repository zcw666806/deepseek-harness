/** Resolve machine bindings without encoding them into portable capability manifests. */
import { resolve, basename } from 'node:path'
import s from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Config as ConfigInput } from './types.ts'

/** Operator configuration before defaults. */
export type Config = ConfigInput
/** Loader validation of host bindings and process bounds. */
export const Config: s<ConfigInput> = s.object({
  directory: s.string(), pythonPath: s.string().default('python'), artifactDirectory: s.string(),
  manifestName: s.string().default('manifest.json'), manifestSha256: s.string(), version: s.string().default('0.43.0'),
  port: s.number().step(1).min(1).max(65535).default(8188),
  startupTimeoutMs: s.number().step(1).min(1).max(2147483647).default(120000),
  pollIntervalMs: s.number().step(1).min(1).max(2147483647).default(500),
  processGraceMs: s.number().step(1).min(1).max(2147483647).default(2000),
  maxProcessOutputBytes: s.number().step(1).min(1).max(1048576).default(16384),
  maxHealthBytes: s.number().step(1).min(1).max(1048576).default(65536),
  healthTimeoutMs: s.number().step(1).min(1).max(2147483647).default(3000),
})

/** Complete host settings; portable manifests retain only engine identity and version. */
export interface ResolvedConfig extends Required<Omit<ConfigInput, 'artifactDirectory' | 'manifestSha256'>> {
  readonly artifactDirectory?: string
  readonly manifestSha256?: string
  readonly endpoint: string
}

/**
 * Resolve paths and reject incomplete artifact-cache bindings.
 * @param input - Trusted machine-local operator settings.
 * @returns Validated settings; no process or network request starts here.
 */
export function resolveConfig(input: ConfigInput): ResolvedConfig {
  const config = Config(input) as Required<Omit<ConfigInput, 'directory' | 'artifactDirectory' | 'manifestSha256'>> & Pick<ConfigInput, 'directory' | 'artifactDirectory' | 'manifestSha256'>
  if (!config.pythonPath.trim() || !config.version.trim() || !config.manifestName.trim()
    || basename(config.manifestName) !== config.manifestName) throw new Error('ComfyUI runtime executable, version and manifest basename must be nonempty.')
  if (config.directory !== undefined && !config.directory.trim()) throw new Error('ComfyUI runtime directory must be nonempty.')
  if (config.artifactDirectory !== undefined && !config.artifactDirectory.trim()) throw new Error('ComfyUI artifact directory must be nonempty.')
  if ((config.artifactDirectory === undefined) !== (config.manifestSha256 === undefined)) throw new Error('ComfyUI artifactDirectory and manifestSha256 must be configured together.')
  if (config.manifestSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(config.manifestSha256)) throw new Error('ComfyUI manifestSha256 must contain 64 hexadecimal digits.')
  return {
    ...config, directory: resolve(config.directory ?? resolve(resolveDshHome(), 'runtimes/comfyui')),
    ...config.artifactDirectory === undefined ? {} : { artifactDirectory: resolve(config.artifactDirectory) },
    endpoint: `http://127.0.0.1:${config.port}/`,
  }
}
