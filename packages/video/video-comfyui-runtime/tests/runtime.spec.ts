import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalEnvironment, SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { ManagedComfyRuntime } from '../src/runtime.ts'

const disposers: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })
const signal = () => new AbortController().signal

class FixtureProcesses extends SubprocessRuntime {
  readonly specs: SubprocessSpawnSpec[] = []
  start = (): void => {}
  stop = (): void => {}
  stopped = 0
  async resolveExecutable(command: string): Promise<string> { return command }
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    const server = !spec.argv.includes('-S')
    const completion = Promise.withResolvers<{ exitCode: number; signal: null }>()
    if (server) this.start()
    else completion.resolve({ exitCode: 0, signal: null })
    return {
      stdin: undefined, stdout: undefined, stderr: undefined, control: undefined,
      done: completion.promise, collected: {},
      terminate: () => {
        if (server) { this.stopped++; this.stop() }
        completion.resolve({ exitCode: 0, signal: null })
      },
      waitForExit: async () => { await completion.promise; return true },
    }
  }
  terminalEnvironment(): Promise<SubprocessTerminalEnvironment> {
    return Promise.reject(new Error('No terminal in runtime fixture'))
  }

  spawnTerminal(): Promise<SubprocessTerminalHandle> { return Promise.reject(new Error('No terminal in runtime fixture')) }
}

async function fixture(initiallyReady = false) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-owned-runtime-'))
  let ready = initiallyReady
  const server = createServer((_request, response) => {
    response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify({ system: { comfyui_version: '0.43.0' } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  disposers.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
    await rm(root, { recursive: true, force: true })
  })
  const python = join(root, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  await mkdir(join(root, 'source'), { recursive: true })
  await mkdir(join(python, '..'), { recursive: true })
  await writeFile(python, 'fixture executable')
  await writeFile(join(root, 'source/main.py'), 'fixture source')
  await writeFile(join(root, 'installation.json'), JSON.stringify({ manifestSha256: 'a'.repeat(64) }))
  const ctx = new Context()
  disposers.push(() => ctx.fiber.dispose())
  ctx.provide('fs', { processPathFromHostPath: (path: string) => path } as FileSystem)
  await ctx.plugin(FixtureProcesses)
  const processes = ctx.subprocess as FixtureProcesses
  processes.start = () => { ready = true }
  processes.stop = () => { ready = false }
  const config = resolveConfig({ directory: root, port: (server.address() as AddressInfo).port, artifactDirectory: root, manifestSha256: 'a'.repeat(64), pollIntervalMs: 1 })
  const runtime = new ManagedComfyRuntime(ctx, config)
  disposers.push(() => runtime.dispose())
  return { runtime, config, processes, ready: () => ready, setReady: (value: boolean) => { ready = value } }
}

describe('DSH-owned ComfyUI lifecycle', () => {
  it('connects to an existing service without adopting or terminating it', async () => {
    const app = await fixture(true)
    await app.runtime.start(signal())
    expect(await app.runtime.inspect(signal())).toMatchObject({ status: 'ready', owned: false })
    await app.runtime.stop(signal())
    expect(app.ready()).toBe(true)
    expect(app.processes.specs).toEqual([])
  })

  it('verifies preparation, starts an owned process, and awaits its stop and private-bytecode cleanup', async () => {
    const app = await fixture()
    await app.runtime.start(signal())
    expect(await app.runtime.inspect(signal())).toMatchObject({ status: 'ready', owned: true })
    expect(app.processes.specs).toHaveLength(2)
    const spec = app.processes.specs[1]!
    expect(spec.argv).toEqual(expect.arrayContaining(['--cpu', '--listen', '127.0.0.1', '--offline', '--disable-all-custom-nodes']))
    expect(spec.env?.['PYTHONPATH']).toBeUndefined()
    expect(spec.env?.['HF_HUB_OFFLINE']).toBe('1')
    expect(spec.env?.['HOME']).toContain(app.config.directory)
    await app.runtime.stop(signal())
    expect(app.ready()).toBe(false)
    expect(app.processes.stopped).toBe(1)
    expect(await app.runtime.inspect(signal())).toMatchObject({ status: 'stopped', owned: false })
  })

  it('terminates a partially started process when startup is cancelled', async () => {
    const app = await fixture()
    const started = Promise.withResolvers<undefined>()
    app.processes.start = () => { started.resolve(undefined) }
    const controller = new AbortController()
    const operation = app.runtime.start(controller.signal)
    const checked = expect(operation).rejects.toThrow()
    await started.promise
    controller.abort(new Error('Caller cancelled startup'))
    await checked
    expect(app.processes.stopped).toBe(1)
    expect(app.ready()).toBe(false)
  })

  it('rejects incomplete machine bindings at load', () => {
    expect(() => resolveConfig({ artifactDirectory: 'cache' })).toThrow('together')
    expect(() => resolveConfig({ artifactDirectory: 'cache', manifestSha256: 'bad' })).toThrow('64 hexadecimal')
    expect(() => resolveConfig({ manifestName: '../manifest.json' })).toThrow('basename')
    expect(() => resolveConfig({ directory: '' })).toThrow('nonempty')
  })
})
