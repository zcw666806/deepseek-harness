/** Import a restaurant document and generate an opt-in Harness overlay. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { extractProject, FileProjectStore } from './src/project.ts'

/** Paths needed to launch and retain one restaurant workspace. */
export interface PreparedWorkspace {
  directory: string
  patchPath: string
  toolsPatchPath: string
  projectPath: string
}

/**
 * Preserve the supplied document, initialize its project, and write an absolute-path overlay.
 * @param source - offline restaurant document whose JSON literals are imported without execution.
 * @param workspace - dedicated writable directory; a different existing source is refused.
 * @param pollIntervalMs - idle viewer synchronization interval, at least 250 milliseconds.
 * @returns launch and persistence paths; an existing project is retained.
 */
export function prepareWorkspace(source: string, workspace: string, pollIntervalMs: number): PreparedWorkspace {
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 250) throw new Error('poll interval must be at least 250 ms')
  const sourcePath = resolve(source)
  const directory = resolve(workspace)
  const importedSource = readFileSync(sourcePath, 'utf8')
  const initial = extractProject(importedSource)
  const preservedSource = join(directory, 'source.html')
  if (existsSync(preservedSource) && readFileSync(preservedSource, 'utf8') !== importedSource) {
    throw new Error('This workspace contains a different restaurant. Choose a new workspace directory.')
  }
  mkdirSync(directory, { recursive: true })
  if (!existsSync(preservedSource)) copyFileSync(sourcePath, preservedSource)
  const projectPath = join(directory, 'project.json')
  new FileProjectStore(projectPath, initial)
  const patchPath = join(directory, 'cordis.yml')
  const moduleUrl = (file: string): string => new URL('./src/' + file, import.meta.url).href
  const toolRows = [
    '- insert:',
    '    - id: restaurant-project',
    '      name: ' + JSON.stringify(moduleUrl('service.ts')),
    '      config:',
    '        sourceHtml: ' + JSON.stringify(preservedSource),
    '        projectPath: ' + JSON.stringify(projectPath),
    '    - id: restaurant-tools',
    '      name: ' + JSON.stringify(moduleUrl('plugin.ts')),
  ]
  const yaml = [...toolRows,
    '    - id: restaurant-web',
    '      name: ' + JSON.stringify(moduleUrl('web.ts')),
    '      config:',
    '        pollIntervalMs: ' + String(pollIntervalMs),
    '',
  ].join('\n')
  writeFileSync(patchPath, yaml, 'utf8')
  const toolsPatchPath = join(directory, 'tools.patch.yml')
  writeFileSync(toolsPatchPath, [...toolRows, ''].join('\n'), 'utf8')
  return { directory, patchPath, toolsPatchPath, projectPath }
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: {
    source: { type: 'string' }, workspace: { type: 'string' }, 'poll-interval': { type: 'string', default: '1000' },
  } })
  if (values.source === undefined || values.workspace === undefined) {
    throw new Error('Usage: setup.ts --source <restaurant.html> --workspace <project-directory> [--poll-interval 1000]')
  }
  const result = prepareWorkspace(values.source, values.workspace, Number(values['poll-interval']))
  process.stdout.write(JSON.stringify({ ...result, pagePath: '/api/restaurant.workbench' }, null, 2) + '\n')
}
