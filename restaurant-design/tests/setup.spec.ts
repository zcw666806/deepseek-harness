/** Workspace imports retain both the supplied document and accepted project changes. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { prepareWorkspace } from '../setup.ts'
import { FileProjectStore } from '../src/project.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('imports JSON without executing the document and retains a saved project on repeated setup', () => {
  const root = mkdtempSync(join(tmpdir(), 'restaurant-setup-'))
  roots.push(root)
  const source = join(root, '餐厅.html')
  const initialState = { furniture: [{ id: 'a', name: 'table', type: 'table', cx: 2000, cy: 2000, w: 600, d: 700, rot: 0, color: '#fff' }], rooms: {}, demolished: [], measures: [] }
  const sourceText = [
    '<!doctype html><script>throw new Error("must not execute");</script>',
    'const WALLS = [];', 'const WINS = [];', 'const DOORS = [];', 'const SLIDES = [];', 'const ROOMS = [];',
    'const BOUNDS = {"x":0,"y":0,"w":10000,"h":10000};',
    'let state = ' + JSON.stringify(initialState) + ';', '',
  ].join('\n')
  writeFileSync(source, sourceText)
  const first = prepareWorkspace(source, join(root, 'workspace'), 1000)
  expect(readFileSync(join(first.directory, 'source.html'), 'utf8')).toBe(sourceText)
  expect(readFileSync(first.patchPath, 'utf8')).toContain('file:///')
  expect(readFileSync(first.toolsPatchPath, 'utf8')).not.toContain('restaurant-web')
  const store = new FileProjectStore(first.projectPath)
  store.move(0, ['a'], 300, 0)
  prepareWorkspace(source, first.directory, 1000)
  expect(new FileProjectStore(first.projectPath).read().state.furniture[0]?.cx).toBe(2300)
  writeFileSync(source, sourceText + '\n<!-- changed -->')
  expect(() => prepareWorkspace(source, first.directory, 1000)).toThrow('different restaurant')
  expect(readFileSync(join(first.directory, 'source.html'), 'utf8')).toBe(sourceText)
})
