/** Source-mode tests for the optional restaurant workspace. */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const directory = dirname(fileURLToPath(import.meta.url))
let repository = directory
while (!existsSync(join(repository, 'tsconfig.base.json'))) {
  const parent = dirname(repository)
  if (parent === repository) throw new Error('Restaurant tests require a Harness repository checkout')
  repository = parent
}

export default defineConfig(async () => {
  const { standardDecoratorPlugin, vitestExecArgv } = await import(
    pathToFileURL(join(repository, 'vitest.shared.ts')).href
  )
  return {
    root: repository,
    plugins: [
      tsconfigPaths({ projects: [join(repository, 'tsconfig.base.json')] }),
      standardDecoratorPlugin(),
    ],
    test: {
      include: [join(directory, 'tests/**/*.spec.ts').replaceAll('\\', '/')],
      setupFiles: [join(repository, 'scripts/test-invariants.ts')],
      pool: 'forks',
      execArgv: vitestExecArgv,
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  }
})
