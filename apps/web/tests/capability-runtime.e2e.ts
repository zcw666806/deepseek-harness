/** Explicitly opted-in management of an approved local runtime; media consists only of native black frames. */
import { execFile } from 'node:child_process'
import { createConnection } from 'node:net'
import { promisify } from 'node:util'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import { CapabilityId } from '@deepseek-ai/dsh-capability-manager'
import type { CapabilityView } from '@deepseek-ai/dsh-capability-manager/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { ComfyWorkflow } from '@deepseek-ai/dsh-video-comfyui'
import type { VideoShotId } from '@deepseek-ai/dsh-video-production/types'
import type {} from '@deepseek-ai/dsh-video-production'
import { launchWebScaffold, seedSession, selectedSessionFixture, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'

const DIRECTORY = process.env.DSH_TEST_COMFYUI_RUNTIME_DIRECTORY
const ARTIFACTS = process.env.DSH_TEST_COMFYUI_ARTIFACT_DIRECTORY
const PYTHON = process.env.DSH_TEST_COMFYUI_PYTHON_PATH
const PORT = process.env.DSH_TEST_COMFYUI_PORT
const MANIFEST = process.env.DSH_TEST_COMFYUI_MANIFEST_SHA256
const FRESH = process.env.DSH_TEST_COMFYUI_FRESH_RECOVERY === '1'
const APPROVED_MANIFEST = '5d1d248af075c05a55cf9e00c551a7ac32e97e499297e84afdd140175fcf659c'
const FRESH_DIRECTORY = resolve(REPO_ROOT, '.tools/assistant-recovery-validation/comfyui')
const SESSION = SessionId('managed-comfyui-native-diagnostic')
const ENGINE = CapabilityId('engine.comfyui')
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.v4.jsonl', import.meta.url))

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function freshTarget(root: string): Promise<void> {
  if (resolve(root) !== FRESH_DIRECTORY) throw new Error('Fresh recovery requires the exact separately reviewed target directory.')
  if (await exists(root)) throw new Error('The fresh recovery target already exists; it will not be removed, overwritten, or reused.')
  for (let parent = dirname(FRESH_DIRECTORY); parent !== dirname(parent); parent = dirname(parent)) {
    if (await exists(parent) && (await lstat(parent)).isSymbolicLink()) throw new Error('Fresh recovery cannot traverse a linked ancestor directory.')
  }
}

async function installationIdentity(root: string): Promise<unknown> {
  const value: unknown = JSON.parse(await readFile(join(root, 'installation.json'), 'utf8'))
  expect(value).toMatchObject({ manifestSha256: APPROVED_MANIFEST, sourceCommit: '426f5eea52a7ece1dd599fff4cb6cd1f352ddd24', wheelCount: 75 })
  for (const path of ['venv/Scripts/python.exe', 'source/main.py', 'approved-manifest.json']) {
    expect((await lstat(join(root, path))).isFile()).toBe(true)
  }
  return value
}

async function listening(port: number): Promise<boolean> {
  return new Promise<boolean>((resolveValue, reject) => {
    let connected = false
    let failure: Error | undefined
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(3000, () => {
      failure = new Error('The dedicated runtime listener probe timed out.')
      socket.destroy()
    })
    socket.once('connect', () => { connected = true; socket.destroy() })
    socket.once('error', (error) => {
      if (!('code' in error) || error.code !== 'ECONNREFUSED') failure = error
    })
    socket.once('close', () => { if (failure === undefined) resolveValue(connected); else reject(failure) })
  })
}

const exec = promisify(execFile)

async function listenerPid(port: number): Promise<number> {
  const { stdout } = await exec('netstat.exe', ['-ano', '-p', 'tcp'], { timeout: 5_000, windowsHide: true })
  for (const line of stdout.split(/\r?\n/u)) {
    const [protocol, local, remote, , pid] = line.trim().split(/\s+/u)
    if (protocol !== 'TCP' || local !== `127.0.0.1:${port}` || remote !== '0.0.0.0:0') continue
    const value = Number(pid)
    if (Number.isSafeInteger(value) && value > 0) return value
  }
  throw new Error(`The dedicated listener at 127.0.0.1:${port} has no process identity.`)
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}

// The reviewed artifact set is Windows CPU-only. CI does not acquire a runtime or a fixed host port implicitly.
// A separately approved fresh run uses CLI --testTimeout 300000 --hookTimeout 300000 for offline preparation.
describe.skipIf(process.platform !== 'win32' || DIRECTORY === undefined || ARTIFACTS === undefined || PYTHON === undefined
  || PORT === undefined || MANIFEST === undefined || webSnapshotMode() === 'record')(
  'approved ComfyUI lifecycle through the shipped DSH capability manager', () => {
    let scaffold: WebScaffold | undefined
    let directory: string | undefined
    let port: number
    let endpoint: string
    let installation: unknown
    const handles: SubprocessHandle[] = []
    const listenerPids: number[] = []
    const processes: { argv: readonly string[]; handle: SubprocessHandle }[] = []

    beforeAll(async () => {
      if (DIRECTORY === undefined || ARTIFACTS === undefined || PYTHON === undefined || PORT === undefined || MANIFEST === undefined) {
        throw new Error('The approved runtime requires explicit local bindings.')
      }
      port = Number(PORT)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DSH_TEST_COMFYUI_PORT must be a valid dedicated loopback port.')
      if (MANIFEST !== APPROVED_MANIFEST) throw new Error('This test only runs the reviewed fixed artifact manifest.')
      if (FRESH && port !== 8188) throw new Error('The reviewed fresh recovery target requires loopback port 8188.')
      if (FRESH) await freshTarget(DIRECTORY)
      if (await listening(port)) throw new Error('The dedicated port already has a listener; this test will not adopt or stop an external service.')
      if (!FRESH) installation = await installationIdentity(DIRECTORY)
      endpoint = `http://127.0.0.1:${port}/`
      const workflow: ComfyWorkflow = {
        id: 'managed-native-black', title: 'DSH 托管引擎 · 无模型黑帧自检',
        template: {
          text: { class_type: 'PrimitiveString', inputs: { value: 'Model-free diagnostic; this text is not linked to image generation.' } },
          frames: { class_type: 'EmptyImage', inputs: { width: 480, height: 480, batch_size: 8, color: 0 } },
          video: { class_type: 'CreateVideo', inputs: { images: ['frames', 0], fps: 8 } },
          save: { class_type: 'SaveVideo', inputs: {
            video: ['video', 0], filename_prefix: 'diagnostic', format: 'mp4', 'format.codec': 'h264',
          } },
        },
        prompt: { node: 'text', input: 'value' },
        duration: { node: 'frames', input: 'batch_size', unit: 'frames', fps: 8 },
        width: { node: 'frames', input: 'width' }, height: { node: 'frames', input: 'height' },
        references: [], outputPrefix: { node: 'save', input: 'filename_prefix' }, durations: [1],
        sizes: [{ aspectRatio: '1:1', resolution: '480p', width: 480, height: 480 }],
        output: { node: 'save', key: 'images', index: 0 },
      }
      directory = await mkdtemp(join(tmpdir(), 'dsh-managed-runtime-e2e-'))
      const overlay = join(directory, 'managed-runtime.patch.yml')
      await writeFile(overlay, JSON.stringify([
        { id: 'video-comfyui-runtime', config: {
          directory: DIRECTORY, artifactDirectory: ARTIFACTS, pythonPath: PYTHON, port,
          manifestSha256: MANIFEST, version: '0.43.0',
        } },
        { id: 'video-comfyui', config: {
          enabled: true, baseURL: endpoint, managedCapability: 'engine.comfyui', workflows: [workflow],
        } },
      ]))
      scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
      const spawn = scaffold.ctx.subprocess.spawn.bind(scaffold.ctx.subprocess)
      const main = join(resolve(DIRECTORY), 'source/main.py')
      vi.spyOn(scaffold.ctx.subprocess, 'spawn').mockImplementation((spec) => {
        const handle = spawn(spec)
        processes.push({ argv: spec.argv, handle })
        if (spec.argv.includes(main)) handles.push(handle)
        return handle
      })
      const fixture = (await readFile(await selectedSessionFixture(FIXTURE), 'utf8')).split('{{cwd}}').join(JSON.stringify(scaffold.workspaceCwd).slice(1, -1))
      await seedSession(scaffold, fixture, SESSION)
    })

    afterAll(async () => {
      try { await scaffold?.close() } finally {
        vi.restoreAllMocks()
        if (directory !== undefined) await rm(directory, { recursive: true, force: true, maxRetries: 3 })
      }
    })

    it('starts and stops its owned engine, automatically starts it for a project, and reaps it on disposal', async () => {
      onTestFailed(async () => {
        const evidence = join(REPO_ROOT, '.playwright-mcp')
        await mkdir(evidence, { recursive: true })
        await writeFile(join(evidence, FRESH ? 'capability-recovery-real-failure.json' : 'capability-runtime-real-failure.json'), JSON.stringify({
          processes: processes.map(item => ({
            argv: item.argv,
            stdout: item.handle.collected.stdout?.readFrom(0).text,
            stderr: item.handle.collected.stderr?.readFrom(0).text,
          })), listenerPids, listenerPresent: await listening(port),
        }, null, 2) + '\n')
      })
      const app = scaffold
      if (app === undefined) throw new Error('The managed runtime scaffold is unavailable.')
      if (DIRECTORY === undefined) throw new Error('The approved runtime directory is required.')
      let prepared: CapabilityView | undefined
      if (FRESH) {
        await freshTarget(DIRECTORY)
        expect(await listening(port)).toBe(false)
        const missing = await app.ctx.capabilities.perform(ENGINE, 'check', new AbortController().signal)
        expect(missing).toMatchObject({ status: 'missing', owned: false })
        prepared = await app.ctx.capabilities.perform(ENGINE, 'prepare', new AbortController().signal)
        expect(prepared, JSON.stringify(prepared)).toMatchObject({ status: 'stopped', owned: false })
        installation = await installationIdentity(DIRECTORY)
        expect(await listening(port)).toBe(false)
      }
      const before = await app.ctx.capabilities.perform(ENGINE, 'check', new AbortController().signal)
      expect(before).toMatchObject({ status: 'stopped', owned: false })
      const started = await app.ctx.capabilities.perform(ENGINE, 'start', new AbortController().signal)
      expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready', owned: true })
      expect(await listening(port)).toBe(true)
      expect(handles).toHaveLength(1)
      const first = handles[0]!
      const firstPid = await listenerPid(port)
      listenerPids.push(firstPid)
      expect(processExists(firstPid)).toBe(true)
      const statsResponse = await fetch(new URL('system_stats', endpoint), { signal: AbortSignal.timeout(10000), redirect: 'error' })
      expect(statsResponse.status).toBe(200)
      const stats = await statsResponse.json() as { system: { comfyui_version: string }; devices: { type: string }[] }
      expect(stats.system.comfyui_version).toBe('0.43.0')
      expect(stats.devices.map(device => device.type)).toEqual(['cpu'])
      const stopped = await app.ctx.capabilities.perform(ENGINE, 'stop', new AbortController().signal)
      expect(stopped).toMatchObject({ status: 'stopped', owned: false })
      expect(await first.waitForExit()).toBe(true)
      expect(processExists(firstPid)).toBe(false)
      await expect.poll(() => listening(port)).toBe(false)

      const empty = await app.ctx.videoProduction.view(SESSION)
      const shotId = 'managed-black-shot' as VideoShotId
      await app.ctx.videoProduction.update(SESSION, {
        revision: empty.revision, title: 'DSH 托管无模型接口自检', assets: [], shots: [{
          id: shotId, title: 'Native black frames', prompt: 'MODEL-FREE DIAGNOSTIC; no model or cloud request is used.',
          duration: 1, aspectRatio: '1:1', resolution: '480p', assetIds: [], position: { x: 0, y: 0 },
        }],
      })
      const project = await app.ctx.videoProduction.generate(SESSION, shotId, {
        generator: 'comfyui', model: 'managed-native-black',
      }, new AbortController().signal)
      const version = project.shots[0]?.versions.at(-1)
      expect(version?.error).toBeUndefined()
      expect(version).toMatchObject({ status: 'completed', generator: 'comfyui', model: 'managed-native-black' })
      if (version?.attachment === undefined) throw new Error('The managed native diagnostic did not return video.')
      const video = await app.ctx.attachments.readVideo(version.attachment)
      expect(Buffer.from(video.data.subarray(4, 8)).toString('ascii')).toBe('ftyp')
      expect(video.data.byteLength).toBe(version.attachment.bytes)
      expect(video.data.byteLength).toBeGreaterThan(100)
      const automatic = await app.ctx.capabilities.perform(ENGINE, 'check', new AbortController().signal)
      expect(automatic).toMatchObject({ status: 'ready', owned: true })
      expect(handles).toHaveLength(2)
      const workerPython = join(resolve(DIRECTORY), 'venv/Scripts/python.exe')
      expect(processes.filter(item => handles.includes(item.handle)).every(item => item.argv[0] === workerPython)).toBe(true)
      const second = handles[1]!
      const secondPid = await listenerPid(port)
      listenerPids.push(secondPid)
      expect(processExists(secondPid)).toBe(true)
      await app.close()
      scaffold = undefined
      expect(await second.waitForExit()).toBe(true)
      expect(processExists(secondPid)).toBe(false)
      await expect.poll(() => listening(port)).toBe(false)
      const evidence = join(REPO_ROOT, '.playwright-mcp')
      await mkdir(evidence, { recursive: true })
      await writeFile(join(evidence, FRESH ? 'capability-recovery-real-evidence.mp4' : 'capability-runtime-native-diagnostic.mp4'), video.data)
      await writeFile(join(evidence, FRESH ? 'capability-recovery-real-evidence.json' : 'capability-runtime-real-evidence.json'), JSON.stringify({
        kind: FRESH ? 'DSH-fresh-offline-recovery-and-native-model-free-video' : 'DSH-managed-approved-runtime-and-native-model-free-video',
        runtimeDirectory: resolve(DIRECTORY), manifestSha256: MANIFEST, freshRecovery: FRESH, installation,
        ...prepared === undefined ? {} : { prepared }, before, started, stopped, automatic,
        processIds: listenerPids, processTreesReaped: true, listenerClosedAfterDisposal: true, version,
      }, null, 2) + '\n')
    })
  },
)
