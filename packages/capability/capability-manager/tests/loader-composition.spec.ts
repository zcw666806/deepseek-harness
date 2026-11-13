import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import CapabilityManager, { CapabilityId } from '../src/index.ts'
import type { CapabilityHealth } from '../src/types.ts'

const disposers: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })

describe('capability management through the Loader', () => {
  it('exposes a provider-owned runtime and portable settings through the shared service', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-capabilities-loader-'))
    const statePath = join(directory, 'runtime.json')
    await writeFile(statePath, JSON.stringify({ started: false, workflow: 'initial' }))
    const ctx = new Context()
    disposers.push(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
    const provider = {
      name: 'fixture-capability', inject: ['capabilities'],
      apply(current: Context) {
        const inspect = async (): Promise<CapabilityHealth> => {
          const data = JSON.parse(await readFile(statePath, 'utf8')) as { started: boolean }
          return { status: data.started ? 'ready' : 'stopped', owned: true, requirements: [] }
        }
        const unregister = current.capabilities.register({
          descriptor: { id: CapabilityId('fixture'), title: 'Fixture engine', description: 'Local state fixture',
            category: 'video', kind: 'local', engineId: 'fixture', version: '1' },
          inspect,
          start: async () => { await writeFile(statePath, JSON.stringify({ started: true, workflow: 'initial' })) },
          exportConfiguration: async () => ({ workflow: 'portable' }),
          restoreConfiguration: async (configuration) => {
            const currentState = JSON.parse(await readFile(statePath, 'utf8')) as { started: boolean }
            await writeFile(statePath, JSON.stringify({ ...currentState, ...configuration as { workflow: string } }))
          },
        })
        current.effect(() => unregister)
      },
    }
    const modules = new Map<string, unknown>([['manager', CapabilityManager], ['provider', provider]])
    const configPath = join(directory, 'cordis.yml')
    await writeFile(configPath, JSON.stringify([{ name: 'manager' }, { id: 'provider', name: 'provider' }]))
    ctx.baseUrl = pathToFileURL(directory).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`Unexpected Loader fixture import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    expect(ctx.capabilities.typertRemote.namespace).toBe('capabilities')
    const signal = new AbortController().signal
    expect((await ctx.capabilities.list(signal))[0]?.status).toBe('stopped')
    await ctx.capabilities.perform(CapabilityId('fixture'), 'start', signal)
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({ started: true })
    const portable = await ctx.capabilities.exportManifest(signal)
    expect(portable.capabilities[0]?.configuration).toEqual({ workflow: 'portable' })
    const plan = await ctx.capabilities.planRestore(portable, signal)
    expect(plan.items[0]).toMatchObject({ status: 'compatible', configuration: 'pending-validation', current: { status: 'ready' } })
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({ started: true, workflow: 'initial' })
    expect(await ctx.capabilities.restoreManifest(portable, signal)).toEqual([{ id: 'fixture', status: 'restored' }])
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({ started: true, workflow: 'portable' })
    const registration = [...ctx.loader.entries()].find(entry => entry.options.id === 'provider')
    await registration?.fiber?.dispose()
    expect(await ctx.capabilities.list(signal)).toEqual([])
  })
})
