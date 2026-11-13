/** Host-local owned ComfyUI process supervision behind the capability registry. */
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { CapabilityHealth, CapabilityProvider } from '@deepseek-ai/dsh-capability-manager/types'
import { CapabilityId } from '@deepseek-ai/dsh-capability-manager'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { ResolvedConfig } from './config.ts'

const helper = fileURLToPath(new URL('../runtime-helper.py', import.meta.url))
// Isolated Python omits the script directory; only the verified engine source is restored for imports.
const launchBootstrap = [
  'import os, runpy, sys',
  'main = sys.argv[1]',
  'sys.path.insert(0, os.path.dirname(main))',
  'sys.argv = sys.argv[1:]',
  'runpy.run_path(main, run_name="__main__")',
].join('\n')

async function exists(path: string): Promise<boolean> {
  try { await access(path, constants.R_OK); return true } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

/** Owns only the handle it starts; an existing listener is never adopted or terminated. */
export class ManagedComfyRuntime {
  private owned: { handle: SubprocessHandle; bytecodeDirectory: string } | undefined
  private readonly lifetime = new AbortController()
  private closing = false

  /** @param ctx - Host-local filesystem and managed subprocess services. @param config - Resolved host bindings and bounds. */
  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  private python(): string { return join(this.config.directory, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') }

  private local(): void {
    const fs = this.ctx.get('fs')
    if (fs === undefined || this.ctx.get('subprocess') === undefined
      || resolve(fs.processPathFromHostPath(this.config.directory) ?? '') !== this.config.directory) {
      throw new Error('This capability requires a host-local filesystem and subprocess provider.')
    }
  }

  private async environment(signal: AbortSignal, data = join(this.config.directory, 'data')): Promise<NodeJS.ProcessEnv> {
    const system = new Set(['SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'OS'])
    const removed = Object.fromEntries(Object.keys(process.env).filter(key => !system.has(key.toUpperCase())).map(key => [key, undefined]))
    const executable = await this.ctx.subprocess.resolveExecutable(
      this.config.pythonPath, undefined, AbortSignal.any([signal, this.lifetime.signal]),
    )
    const paths: Record<string, string> = {
      HOME: join(data, 'home'), USERPROFILE: join(data, 'home'), APPDATA: join(data, 'config/roaming'),
      LOCALAPPDATA: join(data, 'config/local'), XDG_CONFIG_HOME: join(data, 'config'), XDG_CACHE_HOME: join(data, 'cache'),
      HF_HOME: join(data, 'cache/huggingface'), TORCH_HOME: join(data, 'cache/torch'),
      TEMP: join(data, 'temp'), TMP: join(data, 'temp'), TMPDIR: join(data, 'temp'),
    }
    await Promise.all([...new Set(Object.values(paths))].map(path => mkdir(path, { recursive: true })))
    signal.throwIfAborted()
    return {
      ...removed, ...paths, PATH: [join(this.config.directory, 'venv/Scripts'), dirname(executable),
        ...process.env['SYSTEMROOT'] === undefined ? [] : [join(process.env['SYSTEMROOT'], 'System32'), process.env['SYSTEMROOT']]].join(delimiter),
      PYTHONPATH: undefined, PYTHONHOME: undefined, PYTHONUSERBASE: undefined,
      PYTHONNOUSERSITE: '1', HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', TRANSFORMERS_OFFLINE: '1',
      PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null', PIP_NO_INDEX: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1',
    }
  }

  private async healthy(signal: AbortSignal): Promise<boolean> {
    const active = AbortSignal.any([signal, AbortSignal.timeout(this.config.healthTimeoutMs)])
    try {
      const response = await fetch(new URL('system_stats', this.config.endpoint), { signal: active, redirect: 'error' })
      if (!response.ok) { await response.body?.cancel(); return false }
      const reader = response.body?.getReader()
      if (reader === undefined) return false
      const chunks: Uint8Array[] = []
      let bytes = 0
      try {
        while (true) {
          const part = await reader.read()
          if (part.done) break
          bytes += part.value.byteLength
          if (bytes > this.config.maxHealthBytes) { await reader.cancel(); return false }
          chunks.push(part.value)
        }
      } finally { reader.releaseLock() }
      const value: unknown = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))
      return typeof value === 'object' && value !== null && 'system' in value
        && typeof value.system === 'object' && value.system !== null && 'comfyui_version' in value.system
        && value.system.comfyui_version === this.config.version
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof TypeError || error instanceof SyntaxError || active.aborted) return false
      throw error
    }
  }

  /**
   * Describe actual installation and listener readiness without starting processes.
   * @param signal - Inspection cancellation.
   * @returns Safe prerequisite facts and ownership of the current process.
   */
  async inspect(signal: AbortSignal): Promise<CapabilityHealth> {
    signal.throwIfAborted()
    const installed = await exists(this.python()) && await exists(join(this.config.directory, 'source/main.py'))
    const cached = this.config.artifactDirectory !== undefined
      && await exists(join(this.config.artifactDirectory, this.config.manifestName))
    const subprocess = this.ctx.get('subprocess')
    let pythonAvailable = false
    if (subprocess !== undefined) {
      try { await subprocess.resolveExecutable(this.config.pythonPath, undefined, signal); pythonAvailable = true } catch {
        signal.throwIfAborted()
      }
    }
    const ready = await this.healthy(signal)
    return {
      status: ready ? 'ready' : installed ? 'stopped' : 'missing', owned: this.owned !== undefined,
      requirements: [
        { id: 'environment', title: 'ComfyUI runtime', status: installed ? 'available' : 'missing' },
        { id: 'python', title: 'Base Python executable', status: pythonAvailable ? 'available' : 'missing' },
        { id: 'artifact-cache', title: 'Offline artifact manifest', status: cached ? 'available' : 'missing' },
      ],
      ...ready && this.owned === undefined ? { message: 'An existing local service is connected; DSH does not own its process.' } : {},
    }
  }

  /**
   * Verify and prepare only the configured hash-bound local artifact set.
   * @param signal - Complete preparation cancellation.
   * @returns After the installer and its child processes settle.
   */
  async prepare(signal: AbortSignal): Promise<void> {
    this.local()
    if (this.closing) throw new Error('The runtime provider is unloading.')
    if (this.config.artifactDirectory === undefined || this.config.manifestSha256 === undefined) {
      throw new Error('Configure an offline artifact cache and its reviewed manifest SHA-256.')
    }
    const subprocess = this.ctx.subprocess
    const python = await subprocess.resolveExecutable(this.config.pythonPath, undefined, signal)
    const scratch = await mkdtemp(join(tmpdir(), 'dsh-runtime-prepare-'))
    try {
      const handle = subprocess.spawn({
        argv: [python, '-I', '-B', '-S', helper], cwd: dirname(helper), env: await this.environment(signal, scratch),
        signal: AbortSignal.any([signal, this.lifetime.signal]), graceMs: this.config.processGraceMs,
        stdio: {
          stdin: { data: JSON.stringify(this.config) }, stdout: { maxBytes: this.config.maxProcessOutputBytes },
          stderr: { maxBytes: this.config.maxProcessOutputBytes },
        },
      })
      try {
        const outcome = await handle.done
        signal.throwIfAborted()
        if (outcome.exitCode !== 0 || outcome.signal !== null) {
          throw new Error('Offline environment preparation failed; retain its runtime directory for inspection.')
        }
      } finally { handle.terminate(); await handle.waitForExit() }
    } finally { await rm(scratch, { recursive: true, force: true }) }
  }

  /**
   * Start the configured runtime, or connect to an already healthy local listener.
   * @param signal - Startup cancellation; it does not stop a successfully started runtime later.
   * @returns After version-checked readiness, or after failed startup has fully stopped.
   */
  async start(signal: AbortSignal): Promise<void> {
    this.local()
    if (this.closing) throw new Error('The runtime provider is unloading.')
    if (await this.healthy(signal)) return
    if (this.owned !== undefined) await this.stop(signal)
    if (!await exists(this.python())) throw new Error('Prepare this runtime environment before starting it.')
    await this.prepare(signal)
    const marker: unknown = JSON.parse(await readFile(join(this.config.directory, 'installation.json'), 'utf8'))
    if (typeof marker !== 'object' || marker === null || !('manifestSha256' in marker)
      || this.config.manifestSha256 === undefined || marker.manifestSha256 !== this.config.manifestSha256) throw new Error('The installed environment does not match the configured artifact identity.')
    const site = process.platform === 'win32' ? 'venv/Lib/site-packages' : 'venv/lib/python3.13/site-packages'
    const env = await this.environment(signal)
    const bytecodeDirectory = await mkdtemp(join(this.config.directory, 'data/temp/bytecode-'))
    let handle: SubprocessHandle
    try {
      signal.throwIfAborted()
      handle = this.ctx.subprocess.spawn({
        argv: [this.python(), '-I', '-B', '-X', `pycache_prefix=${bytecodeDirectory}`, '-c', launchBootstrap,
          join(this.config.directory, 'source/main.py'), '--cpu', '--listen', '127.0.0.1',
          '--port', String(this.config.port), '--offline', '--disable-all-custom-nodes', '--disable-auto-launch',
          '--front-end-root', join(this.config.directory, site, 'comfyui_frontend_package/static'), '--base-directory', join(this.config.directory, 'data')],
        cwd: this.config.directory, env, signal: this.lifetime.signal, graceMs: this.config.processGraceMs,
        stdio: { stdin: 'ignore', stdout: { maxBytes: this.config.maxProcessOutputBytes }, stderr: { maxBytes: this.config.maxProcessOutputBytes } },
      })
    } catch (error) {
      await rm(bytecodeDirectory, { recursive: true, force: true })
      throw error
    }
    this.owned = { handle, bytecodeDirectory }
    const state = { settled: false }
    const outcome = handle.done.then(() => { state.settled = true }, () => { state.settled = true })
    const active = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(this.config.startupTimeoutMs)])
    try {
      while (true) {
        active.throwIfAborted()
        if (state.settled) throw new Error('ComfyUI stopped before becoming ready.')
        if (await this.healthy(active)) return
        await delay(this.config.pollIntervalMs, undefined, { signal: active })
      }
    } catch (error) {
      await this.stop(new AbortController().signal)
      await outcome
      throw error
    }
  }

  /**
   * Stop only this provider's subprocess tree, never an external listener.
   * @param signal - Cancellation checked before termination begins.
   * @returns After all owned process output and descendants settle.
   */
  async stop(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const owned = this.owned
    if (owned === undefined) return
    const { handle } = owned
    handle.terminate()
    await handle.waitForExit()
    await Promise.allSettled([handle.done])
    if (this.owned === owned) this.owned = undefined
    await rm(owned.bytecodeDirectory, { recursive: true, force: true })
  }

  /**
   * Build the registry contribution without exporting machine-local bindings.
   * @returns Descriptor and lifecycle callbacks bound to this runtime.
   */
  provider(): CapabilityProvider {
    return {
      descriptor: { id: CapabilityId('engine.comfyui'), title: 'ComfyUI', description: 'Managed local workflow execution', category: 'video', engineId: 'comfyui', version: this.config.version, kind: 'local' },
      inspect: signal => this.inspect(signal), start: signal => this.start(signal), stop: signal => this.stop(signal),
      ...this.config.artifactDirectory === undefined ? {} : { prepare: (signal: AbortSignal) => this.prepare(signal) },
    }
  }

  /** Stop admission and await owned process-tree teardown during plugin disposal. */
  async dispose(): Promise<void> {
    this.closing = true
    this.lifetime.abort(new Error('The managed ComfyUI runtime was unloaded.'))
    await this.stop(new AbortController().signal)
  }
}
