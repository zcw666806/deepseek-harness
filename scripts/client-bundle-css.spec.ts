/**
 * Stylesheets enter client bundles through virtual modules, so the loader must
 * register their physical files as watch dependencies.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clientBundle } from '../packages/client/tsdown.client.ts'

interface CssPlugin {
  name: string
  resolveId?: (source: string, importer?: string) => string | null
  load?: (this: { addWatchFile(id: string): void }, id: string) => Promise<string | null>
}

function cssPlugin(name: 'dsh-css-modules-inline' | 'dsh-css-global-inline' | 'dsh-css-text-inline'): CssPlugin {
  const configs = clientBundle(
    '@deepseek-ai/dsh-client-test',
    ['lib/types/index.js', 'lib/types/invariant.js'],
  )({ env: { DSH_BUILD_FACE: 'client' } })
  const client = configs.find(config => config.platform === 'browser')
  if (client === undefined) throw new Error('client config missing')
  const plugins = (client as { plugins: CssPlugin[] }).plugins
  const plugin = plugins.find(candidate => candidate.name === name)
  if (plugin === undefined) throw new Error(`${name} missing from client config`)
  return plugin
}

describe('client bundle CSS Modules', () => {
  it('registers the source stylesheet as a watch dependency', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-client-css-watch-'))
    try {
      const stylesheet = join(root, 'Fixture.module.css')
      const importer = join(root, 'index.ts')
      await writeFile(stylesheet, '.root { color: red; }\n')
      const plugin = cssPlugin('dsh-css-modules-inline')
      const virtualId = plugin.resolveId?.('./Fixture.module.css', importer)
      if (typeof virtualId !== 'string' || plugin.load === undefined) {
        throw new Error('CSS Modules plugin hooks are incomplete')
      }
      const watched: string[] = []

      const output = await plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)

      expect(watched).toEqual([stylesheet])
      expect(output).toContain('data-plugin-css')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('client bundle global CSS', () => {
  it('resolves exported package stylesheets without evaluating a package entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-client-package-css-'))
    try {
      const packageRoot = join(root, 'node_modules/@fixture/canvas-ui')
      await mkdir(join(packageRoot, 'dist'), { recursive: true })
      await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
        name: '@fixture/canvas-ui', version: '0.0.0', type: 'module',
        exports: { './theme.css': './dist/theme.css' },
      }))
      const stylesheet = join(packageRoot, 'dist/theme.css')
      await writeFile(stylesheet, '.canvas { color: blue; }\n')
      for (const name of ['dsh-css-global-inline', 'dsh-css-text-inline'] as const) {
        const plugin = cssPlugin(name)
        const specifier = `@fixture/canvas-ui/theme.css${name === 'dsh-css-text-inline' ? '?inline' : ''}`
        const virtualId = plugin.resolveId?.(specifier, join(root, 'lib/types/client/index.js'))
        if (typeof virtualId !== 'string' || plugin.load === undefined) throw new Error('package stylesheet was not resolved')
        const watched: string[] = []
        const output = await plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)
        expect(watched).toEqual([stylesheet])
        expect(output).toContain('.canvas{color:#00f}')
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('compiles a side-effect stylesheet into a watched style injector', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-client-global-css-watch-'))
    try {
      const stylesheet = join(root, 'base.css')
      const importer = join(root, 'index.ts')
      await writeFile(stylesheet, 'body { color: red; }\n')
      const plugin = cssPlugin('dsh-css-global-inline')
      const virtualId = plugin.resolveId?.('./base.css', importer)
      if (typeof virtualId !== 'string' || plugin.load === undefined) {
        throw new Error('global CSS plugin hooks are incomplete')
      }
      const watched: string[] = []

      const output = await plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)

      expect(watched).toEqual([stylesheet])
      expect(output).toContain('data-plugin-css')
      expect(output).toContain('body{color:red}')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('compiles inline stylesheets as watched text without a module side effect', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-client-inline-css-watch-'))
    try {
      const stylesheet = join(root, 'base.css')
      const importer = join(root, 'index.ts')
      await writeFile(stylesheet, 'body { color: red; }\n')
      const plugin = cssPlugin('dsh-css-text-inline')
      const virtualId = plugin.resolveId?.('./base.css?inline', importer)
      if (typeof virtualId !== 'string' || plugin.load === undefined) {
        throw new Error('inline CSS plugin hooks are incomplete')
      }
      const watched: string[] = []

      const output = await plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)

      expect(watched).toEqual([stylesheet])
      expect(output).toContain('export default "body{color:red}"')
      expect(output).not.toContain('data-plugin-css')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
