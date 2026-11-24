import { describe, expect, it, vi } from 'vitest'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'

function harness() {
  const profiles = resolveProfiles({
    grok: {
      api: 'openai-completions',
      baseURL: 'https://video-routing.invalid/v1',
      defaultContextWindow: 8192,
      defaultMaxTokens: 1024,
      models: [
        { id: 'chat', output: ['text'] },
        { id: 'video', output: ['text', 'video'] },
      ],
    },
  })
  const resolveApiKey = vi.fn(async () => 'test-key')
  const adapter = new PiAiAdapter({ profiles: () => profiles, resolveApiKey, auth: memoryAuth() })
  return { adapter, resolveApiKey }
}

describe('video generation targets', () => {
  it('offers only chat models in the model selector', async () => {
    const { adapter } = harness()
    expect(await adapter.listModels('grok')).toEqual([
      { provider: 'grok', id: 'chat', name: 'chat', inputModalities: ['text'], outputModalities: ['text'] },
    ])
    expect(await adapter.resolveModel('grok', 'chat')).toMatchObject({ id: 'chat' })
  })

  it('refuses direct video model resolution and preparation', async () => {
    const { adapter, resolveApiKey } = harness()
    const failure = {
      code: 'INVALID_REQUEST',
      message: 'pi-ai model "grok/video" is a video generation target; choose a chat model and use generate_video to generate videos',
    }
    await expect(adapter.resolveModel('grok', 'video')).rejects.toMatchObject(failure)
    expect(() => adapter.prepareCall('grok', 'video')).toThrow(expect.objectContaining(failure))
    expect(resolveApiKey).not.toHaveBeenCalled()
  })

  it('refuses video streaming before resolving credentials or contacting the provider', async () => {
    const { adapter, resolveApiKey } = harness()
    const stream = adapter.stream({ provider: 'grok', model: 'video', messages: [] })
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'pi-ai model "grok/video" is a video generation target; choose a chat model and use generate_video to generate videos',
    })
    expect(resolveApiKey).not.toHaveBeenCalled()
  })
})
