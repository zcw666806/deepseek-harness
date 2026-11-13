import { defineConfig } from 'tsdown'

const entry = (path: string) => ({
  entry: [path],
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'es2024' as const,
  fixedExtension: false,
  dts: false,
  clean: false,
})

/** Build standalone entries for the generic bridge and optional REA Host owner. */
export default defineConfig([
  entry('lib/types/index.js'),
  entry('lib/types/rea-experiment.js'),
  entry('lib/types/invariant.js'),
])
