// @vitest-environment jsdom

import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { GeneratedVideoCard, type GeneratedVideoCardProps } from '../src/client/GeneratedVideoCard.tsx'
import { zh } from '../src/client/locales.ts'
import { SESSION, VIDEO } from './fixtures.ts'

afterEach(cleanup)

type VideoResultProps = Extract<GeneratedVideoCardProps, { phase: 'result' }>

function props(overrides: Partial<VideoResultProps> = {}): VideoResultProps {
  return {
    sessionId: SESSION, callId: 'generate-1', toolName: 'generate_video', phase: 'result',
    block: {
      kind: 'tool-result', seq: 10, time: 1, callId: 'generate-1', callTime: 0, name: 'generate_video',
      call: { name: 'generate_video', argsRaw: '{}' }, isError: false,
      content: [{ type: 'text', text: 'Video generated and stored.' }],
      meta: { type: 'video', attachment: VIDEO }, subCalls: [],
    },
    t: makeTranslate(zh, commonZh), openFile: vi.fn(),
    readVideo: vi.fn<GeneratedVideoCardProps['readVideo']>(async (_id, offset) => ({
      attachment: VIDEO, data: btoa('test'.slice(offset)), offset, nextOffset: 4, total: 4,
    })),
    ...overrides,
  } as VideoResultProps
}

describe('generated video result card', () => {
  it('reads authorized byte slices only on demand, then releases its native player URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:generated-video')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    onTestFinished(() => { vi.unstubAllGlobals() })
    const value = props({ readVideo: vi.fn<GeneratedVideoCardProps['readVideo']>(async (_id, offset) => ({
      attachment: VIDEO, data: btoa(offset === 0 ? 'te' : 'st'), offset, nextOffset: offset + 2, total: 4,
    })) })
    const mounted = render(<GeneratedVideoCard {...value} />)
    expect(value.readVideo).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('加载视频'))
    await waitFor(() => { expect(screen.getByLabelText('预览生成视频').getAttribute('src')).toBe('blob:generated-video') })
    expect(vi.mocked(value.readVideo).mock.calls.map(call => call[1])).toEqual([0, 2])
    expect(screen.getByText('下载镜头').getAttribute('href')).toBe('blob:generated-video')
    mounted.unmount()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:generated-video')
  })

  it('preserves failed tool output without offering a preview from its metadata', () => {
    const value = props()
    render(<GeneratedVideoCard {...value} block={{ ...value.block, isError: true }} />)
    expect(screen.getByText('Video generated and stored.')).toBeDefined()
    expect(screen.queryByText('加载视频')).toBeNull()
    expect(value.readVideo).not.toHaveBeenCalled()
  })

  it('retains textual results when persisted video metadata is malformed', () => {
    const value = props()
    render(<GeneratedVideoCard {...value} block={{ ...value.block, meta: { type: 'video', attachment: { ...VIDEO, bytes: -1 } } }} />)
    expect(screen.getByText('Video generated and stored.')).toBeDefined()
    expect(screen.queryByText('加载视频')).toBeNull()
    expect(value.readVideo).not.toHaveBeenCalled()
  })

  it('does not publish a late media response after the result card unmounts', async () => {
    const createObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
    onTestFinished(() => { vi.unstubAllGlobals() })
    const response = Promise.withResolvers<Awaited<ReturnType<GeneratedVideoCardProps['readVideo']>>>()
    const value = props({ readVideo: () => response.promise })
    const mounted = render(<GeneratedVideoCard {...value} />)
    fireEvent.click(screen.getByText('加载视频'))
    mounted.unmount()
    response.resolve({ attachment: VIDEO, data: btoa('test'), offset: 0, nextOffset: 4, total: 4 })
    await response.promise
    await Promise.resolve()
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
