/** Provider-declared limits control whether the workspace can submit the visible shot. */
import { describe, expect, it } from 'vitest'
import type { VideoAssetId, VideoGenerationLimits } from '@deepseek-ai/dsh-video-production/types'
import { acceptsShot, generationTargetKey } from '../src/client/generation-target.ts'
import { project } from './fixtures.ts'

describe('generation target selection', () => {
  const shot = project().shots[0]!

  it('accepts undeclared limits and every explicitly supported shot input', () => {
    expect(acceptsShot({ generator: 'fixture', title: 'Fixture' }, shot)).toBe(true)
    expect(acceptsShot({ generator: 'fixture', title: 'Fixture', limits: {
      durations: [3], aspectRatios: ['16:9'], resolutions: ['480p'], minReferenceImages: 0, maxReferenceImages: 0,
    } }, shot)).toBe(true)
  })

  it.each<[string, VideoGenerationLimits]>([
    ['duration', { durations: [6] }],
    ['aspect ratio', { aspectRatios: ['9:16'] }],
    ['resolution', { resolutions: ['720p'] }],
    ['required reference', { minReferenceImages: 1 }],
  ])('rejects a shot outside the declared %s support', (_name, limits) => {
    expect(acceptsShot({ generator: 'fixture', title: 'Fixture', limits }, shot)).toBe(false)
  })

  it('rejects extra references and keeps models on the same generator distinct', () => {
    expect(acceptsShot({ generator: 'fixture', title: 'Fixture', limits: { maxReferenceImages: 0 } }, {
      ...shot, assetIds: ['image' as VideoAssetId],
    })).toBe(false)
    expect(generationTargetKey({ generator: 'same', title: 'First', model: 'one' }))
      .not.toBe(generationTargetKey({ generator: 'same', title: 'Second', model: 'two' }))
    expect(generationTargetKey({ generator: 'same', title: 'First' }))
      .toBe(generationTargetKey({ generator: 'same', title: 'Renamed' }))
  })
})
