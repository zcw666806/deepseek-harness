// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { AttachmentId, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { VideoAssetId, VideoBatchId, VideoProject, VideoProjectInput, VideoVersionId } from '@deepseek-ai/dsh-video-production/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { VideoProductionView, reorderedShotIds, selectedVersion, type VideoProductionViewProps } from '../src/client/VideoProductionView.tsx'
import { createVideoCanvasStore } from '../src/client/canvas-store.ts'
import type { ProductionSnapshot } from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'
import { project, SESSION, SHOT_A, SHOT_B, VERSION_A, VIDEO } from './fixtures.ts'

// jsdom has no layout observer; browser tests own canvas geometry and pointer connections.
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function props(overrides: Partial<VideoProductionViewProps> = {}) {
  const canvas = createVideoCanvasStore().create(SESSION)
  canvas.actions.select(SHOT_A)
  const snapshot: ProductionSnapshot = {
    project: project(), transfer: null, projectDownload: null, restored: null, capabilityRestorations: [],
    batch: null,
    targets: [{ generator: 'fixture', title: 'Fixture' }], operation: null, error: null, media: {}, mediaLoading: [], mediaErrors: {} }
  return {
    sessionId: SESSION, t: makeTranslate(zh, commonZh), actions: canvas.actions,
    useStore: selector => selector(canvas.getSnapshot()),
    useProduction: selector => selector(snapshot),
    restoreCapabilities: vi.fn(), exportProject: vi.fn(), importProject: vi.fn(), refresh: vi.fn(),
    save: vi.fn(), generate: vi.fn(), reorder: vi.fn(), exportFilm: vi.fn(),
    generateMissing: vi.fn(), pauseBatch: vi.fn(), cancelBatch: vi.fn(), resumeBatch: vi.fn(),
    cancel: vi.fn(), loadMedia: vi.fn(), addAsset: vi.fn(),
    ...overrides,
  } as VideoProductionViewProps
}

describe('video production workspace', () => {
  it('saves clip cuts, original volume and timed captions without regenerating the source', () => {
    const save = vi.fn<(input: VideoProjectInput) => void>()
    const value = props({ save })
    render(<VideoProductionView {...value} />)
    fireEvent.change(screen.getByLabelText('裁切起点（秒）'), { target: { value: '0.25' } })
    fireEvent.change(screen.getByLabelText('裁切终点（秒）'), { target: { value: '0.75' } })
    fireEvent.change(screen.getByLabelText('原声音量（0 为静音，1 为原音量）'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '添加字幕' }))
    fireEvent.change(screen.getByLabelText('字幕 1 文本'), { target: { value: 'First caption' } })
    fireEvent.change(screen.getByLabelText('字幕 1 结束（秒）'), { target: { value: '0.4' } })
    fireEvent.click(screen.getByRole('button', { name: '保存分镜' }))
    expect(save.mock.calls[0]?.[0].shots.find(shot => shot.id === SHOT_A)?.edit).toEqual({
      trimStartSeconds: 0.25, trimEndSeconds: 0.75, volume: 0,
      captions: [{ startSeconds: 0, endSeconds: 0.4, text: 'First caption' }],
    })
    expect(value.generate).not.toHaveBeenCalled()
    expect(value.exportFilm).not.toHaveBeenCalled()
  })

  it('keeps invalid caption timing as a draft until the user corrects it', () => {
    const value = props()
    render(<VideoProductionView {...value} />)
    fireEvent.click(screen.getByRole('button', { name: '添加字幕' }))
    fireEvent.change(screen.getByLabelText('字幕 1 文本'), { target: { value: 'Caption draft' } })
    fireEvent.change(screen.getByLabelText('字幕 1 开始（秒）'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存分镜' }))
    expect(value.save).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByLabelText<HTMLTextAreaElement>('字幕 1 文本').value).toBe('Caption draft')
    fireEvent.click(screen.getByRole('button', { name: '恢复完整镜头与原音量' }))
    fireEvent.click(screen.getByRole('button', { name: '保存分镜' }))
    expect(value.save).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('字幕 1 文本')).toBeNull()
  })

  it('requires an explicit choice among targets, forwards it to single and batch requests, and never replaces a missing target', () => {
    const grok = { generator: 'llm-pi-ai', title: 'Grok', model: 'grok-video' }
    const comfy = { generator: 'comfyui/test-workflow', title: 'ComfyUI test workflow' }
    let snapshot: ProductionSnapshot = {
      project: project(), transfer: null, projectDownload: null, restored: null, capabilityRestorations: [],
      batch: null,
      targets: [grok, comfy], operation: null, error: null, media: {}, mediaLoading: [], mediaErrors: {},
    }
    const value = props({ useProduction: selector => selector(snapshot) })
    const rendered = render(<VideoProductionView {...value} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重新生成' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('本次生成目标'), { target: { value: JSON.stringify([comfy.generator, null]) } })
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    expect(value.generate).toHaveBeenCalledExactlyOnceWith(SHOT_A, { generator: comfy.generator })
    fireEvent.click(screen.getByRole('button', { name: '生成缺失镜头' }))
    expect(value.generateMissing).toHaveBeenCalledExactlyOnceWith({ generator: comfy.generator })
    expect(value.save).not.toHaveBeenCalled()
    snapshot = { ...snapshot, transfer: null, projectDownload: null, restored: null, capabilityRestorations: [],
      batch: null,
      targets: [grok] }
    rendered.rerender(<VideoProductionView {...value} />)
    expect(screen.getByRole('alert').textContent).toContain('请重新选择')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重新生成' }).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLSelectElement>('本次生成目标').value).toBe(JSON.stringify([comfy.generator, null]))
  })

  it('does not advertise unconfigured targets or enable generation outside declared limits', () => {
    let snapshot: ProductionSnapshot = {
      project: project(), transfer: null, projectDownload: null, restored: null, capabilityRestorations: [],
      batch: null,
      targets: [], operation: null, error: null, media: {}, mediaLoading: [], mediaErrors: {},
    }
    const value = props({ useProduction: selector => selector(snapshot) })
    const rendered = render(<VideoProductionView {...value} />)
    expect(screen.getByText('尚未配置可用的视频生成目标。请配置Grok或启用ComfyUI工作流。')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成缺失镜头' }).disabled).toBe(true)
    snapshot = { ...snapshot, transfer: null, projectDownload: null, restored: null, capabilityRestorations: [],
      batch: null,
      targets: [{ generator: 'limited', title: 'Limited fixture', limits: { durations: [1] } }] }
    rendered.rerender(<VideoProductionView {...value} />)
    fireEvent.change(screen.getByLabelText('本次生成目标'), { target: { value: JSON.stringify(['limited', null]) } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重新生成' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成缺失镜头' }).disabled).toBe(true)
  })

  it('collapses duplicate asset browsing for an existing graph and retains upload fields across toggles', () => {
    render(<VideoProductionView {...props()} />)
    const toggle = screen.getByRole('button', { name: '素材库' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText('素材名称')).toBeNull()
    fireEvent.click(toggle)
    fireEvent.change(screen.getByLabelText('素材名称'), { target: { value: 'Traveler reference' } })
    fireEvent.change(screen.getByLabelText('素材类型'), { target: { value: 'scene' } })
    fireEvent.click(toggle)
    expect(screen.queryByLabelText('素材名称')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByLabelText<HTMLInputElement>('素材名称').value).toBe('Traveler reference')
    expect(screen.getByLabelText<HTMLSelectElement>('素材类型').value).toBe('scene')
    expect(screen.getByLabelText('选择图片')).toBeTruthy()
  })

  it('opens the asset library for an empty project and hides the inspector without a selected shot', () => {
    const snapshot: ProductionSnapshot = {
      project: { ...project(), shots: [] }, transfer: null, projectDownload: null, restored: null, capabilityRestorations: [],
      batch: null,
      targets: [{ generator: 'fixture', title: 'Fixture' }], operation: null, error: null, media: {}, mediaLoading: [], mediaErrors: {},
    }
    render(<VideoProductionView {...props({ useProduction: selector => selector(snapshot) })} />)
    expect(screen.getByRole('button', { name: '素材库' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText('素材名称')).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: '节点检查器' })).toBeNull()
  })

  it('saves edited prompts as a revision-fenced draft and prevents generation before save', () => {
    const value = props()
    render(<VideoProductionView {...value} />)
    fireEvent.change(screen.getAllByLabelText('画面描述')[0]!, { target: { value: 'A traveler walks slowly toward the sunset.' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '重新生成' }).disabled).toBe(true)
    fireEvent.click(screen.getByText('保存分镜'))
    expect(value.save).toHaveBeenCalledOnce()
    const saved = vi.mocked(value.save).mock.calls[0]![0]
    expect(saved.revision).toBe(1)
    expect(saved.shots[0]?.prompt).toBe('A traveler walks slowly toward the sunset.')
    expect(saved.shots[0]).not.toHaveProperty('versions')
    expect(saved.shots[0]?.selectedVersionId).toBe(VERSION_A)
  })

  it('requests the complete saved sequence when a shot moves earlier', () => {
    const value = props()
    render(<VideoProductionView {...value} />)
    fireEvent.click(screen.getAllByLabelText('向前移动镜头')[1]!)
    expect(value.reorder).toHaveBeenCalledExactlyOnceWith([SHOT_B, SHOT_A])
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '合成导出' }).disabled).toBe(true)
  })

  it('loads video only on request and renders a native player and download link when ready', () => {
    const snapshot: ProductionSnapshot = {
      project: project(), transfer: null, projectDownload: null, restored: null, capabilityRestorations: [],
      batch: null,
      targets: [{ generator: 'fixture', title: 'Fixture' }], operation: null, error: null, media: { [VIDEO.attachmentId]: 'blob:clip' }, mediaLoading: [], mediaErrors: {} }
    const value = props({ useProduction: selector => selector(snapshot) })
    render(<VideoProductionView {...value} />)
    const video = screen.getAllByLabelText<HTMLVideoElement>('预览镜头 Arrival')[0]!
    expect(video.src).toBe('blob:clip')
    expect(video.controls).toBe(true)
    expect(screen.getByText('下载镜头').getAttribute('href')).toBe('blob:clip')
    expect(value.loadMedia).not.toHaveBeenCalled()
  })

  it('rejects an empty new prompt and leaves the server project untouched', () => {
    const value = props()
    render(<VideoProductionView {...value} />)
    fireEvent.click(screen.getByText('添加分镜'))
    fireEvent.click(screen.getByText('保存分镜'))
    expect(screen.getByRole('alert').textContent).toContain('画面描述')
    expect(value.save).not.toHaveBeenCalled()
    expect(value.generate).not.toHaveBeenCalled()
  })

  it('uses a completed selected version while a later attempt failed', () => {
    const saved = project().shots[0]!
    expect(selectedVersion({ ...saved, versions: [...saved.versions, {
      id: 'failed' as typeof VERSION_A, status: 'failed', prompt: 'Retry', error: 'Provider quota',
      duration: 3, aspectRatio: '16:9', resolution: '480p', referenceImages: [],
    }] })?.id).toBe(VERSION_A)
    expect(reorderedShotIds([SHOT_A, SHOT_B], SHOT_A, 99)).toEqual([SHOT_B, SHOT_A])
    expect(reorderedShotIds([SHOT_A, SHOT_B], 'absent' as typeof SHOT_A, 0)).toEqual([SHOT_A, SHOT_B])
  })

  it('requires an explicitly selected completed version before enabling film export', () => {
    const saved = project()
    const first = saved.shots[0]!
    const { selectedVersionId: _selection, ...unselected } = first
    const snapshot: ProductionSnapshot = {
      project: { ...saved, shots: [unselected] }, transfer: null, projectDownload: null, restored: null, capabilityRestorations: [],
      batch: null,
      targets: [{ generator: 'fixture', title: 'Fixture' }], operation: null, error: null,
      media: {}, mediaLoading: [], mediaErrors: {},
    }
    const value = props({ useProduction: selector => selector(snapshot) })
    render(<VideoProductionView {...value} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '合成导出' }).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLSelectElement>('生成版本').value).toBe('')
    fireEvent.change(screen.getByLabelText('生成版本'), { target: { value: VERSION_A } })
    fireEvent.click(screen.getByText('保存分镜'))
    expect(vi.mocked(value.save).mock.calls[0]![0].shots[0]?.selectedVersionId).toBe(VERSION_A)
  })

  it('keeps recorded generation settings visible after editing the shot prompt', () => {
    render(<VideoProductionView {...props()} />)
    fireEvent.change(screen.getAllByLabelText('画面描述')[0]!, { target: { value: 'A different camera move.' } })
    expect(screen.getByText('输入已修改')).toBeTruthy()
    expect(screen.getByText('A traveler arrives at the coast.')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '生成缺失镜头' }).disabled).toBe(true)
  })

  it('duplicates shot inputs without copying paid generation history or adoption', () => {
    const value = props()
    render(<VideoProductionView {...value} />)
    fireEvent.click(screen.getByRole('button', { name: '复制分镜' }))
    fireEvent.click(screen.getByText('保存分镜'))
    const copy = vi.mocked(value.save).mock.calls[0]![0].shots.at(-1)!
    expect(copy.id).not.toBe(SHOT_A)
    expect(copy.prompt).toBe(project().shots[0]!.prompt)
    expect(copy).not.toHaveProperty('versions')
    expect(copy).not.toHaveProperty('selectedVersionId')
  })

  it('starts a batch explicitly and controls remaining Host work at shot boundaries', () => {
    const value = props()
    const rendered = render(<VideoProductionView {...value} />)
    expect(value.generateMissing).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '生成缺失镜头' }))
    expect(value.generateMissing).toHaveBeenCalledOnce()
    const snapshot: ProductionSnapshot = {
      project: project(), transfer: null, projectDownload: null, restored: null, capabilityRestorations: [],
      batch: { id: 'batch-example' as VideoBatchId, sessionId: SESSION, sessionCreatedAt: 0, projectId: project().id,
        inputRevision: 1, generator: 'fixture', status: 'running', shots: [
          { shotId: SHOT_A, input: 'recorded-first-input', status: 'completed', versionId: VERSION_A },
          { shotId: SHOT_B, input: 'recorded-second-input', status: 'running' },
        ] },
      targets: [{ generator: 'fixture', title: 'Fixture' }], operation: null,
      error: null, media: {}, mediaLoading: [], mediaErrors: {},
    }
    rendered.rerender(<VideoProductionView {...value} useProduction={selector => selector(snapshot)} />)
    expect(screen.getByRole('status').textContent).toBe('已完成 1 / 2')
    fireEvent.click(screen.getByRole('button', { name: '当前镜头完成后暂停' }))
    expect(value.pauseBatch).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '取消后续镜头' }))
    expect(value.cancelBatch).toHaveBeenCalledOnce()
    expect(value.cancel).not.toHaveBeenCalled()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '继续未提交镜头' }).disabled).toBe(true)
  })

  it('labels a retained successful film separately after the newest export fails', () => {
    const saved = project()
    const snapshot: ProductionSnapshot = {
      project: { ...saved, shots: [saved.shots[0]!], exports: [
        { id: 'export-ok' as VideoVersionId, status: 'completed', shotVersionIds: [VERSION_A], attachment: VIDEO },
        { id: 'export-failed' as VideoVersionId, status: 'failed', shotVersionIds: [VERSION_A], error: 'VIDEO_EXPORT_UNAVAILABLE' },
      ] },
      transfer: null, projectDownload: null, restored: null, capabilityRestorations: [],
      batch: null,
      targets: [], operation: null, error: null, media: { [VIDEO.attachmentId]: 'blob:previous-film' }, mediaLoading: [], mediaErrors: {},
    }
    render(<VideoProductionView {...props({ useProduction: selector => selector(snapshot) })} />)
    expect(screen.getByText('最近合成：合成失败')).toBeTruthy()
    expect(screen.getByText('上次成功的成片')).toBeTruthy()
    expect(screen.queryByText('最近合成：已完成')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('VIDEO_EXPORT_UNAVAILABLE')
    expect(screen.getByRole('link', { name: '下载成片' }).getAttribute('href')).toBe('blob:previous-film')
  })

  it('offers assembly for adopted clips without claiming inputs are missing, then shows export progress', () => {
    const saved = project()
    const snapshot: ProductionSnapshot = {
      project: { ...saved, shots: [saved.shots[0]!] }, transfer: null, projectDownload: null, restored: null, capabilityRestorations: [],
      batch: null,
      targets: [{ generator: 'fixture', title: 'Fixture' }], operation: null, error: null,
      media: {}, mediaLoading: [], mediaErrors: {},
    }
    const value = props({ useProduction: selector => selector(snapshot) })
    const rendered = render(<VideoProductionView {...value} />)
    expect(screen.getByText('可以合成')).toBeTruthy()
    expect(screen.getByText('尚未合成成片，点击合成导出')).toBeTruthy()
    expect(screen.queryByText('请先为每个镜头选择已生成的视频版本并保存。')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '合成导出' }).disabled).toBe(false)
    rendered.rerender(<VideoProductionView {...value} useProduction={selector => selector({
      ...snapshot, operation: { kind: 'export' },
    })} />)
    const film = document.querySelector('[data-workflow-kind="film"]')!
    expect(film.textContent).toContain('正在合成…')
    expect(film.textContent).not.toContain('尚未合成成片')
  })

  it('shows reference input order independently of the library and saves reordered inputs without rewriting history', () => {
    const characterId = 'character' as VideoAssetId
    const sceneId = 'scene' as VideoAssetId
    const characterImage: ImageAttachmentRef = {
      attachmentId: 'character-image' as AttachmentId, mediaType: 'image/png', bytes: 4, width: 1, height: 1,
    }
    const sceneImage: ImageAttachmentRef = { ...characterImage, attachmentId: 'scene-image' as AttachmentId }
    const saved = project()
    const first = saved.shots[0]!
    const current: VideoProject = {
      ...saved,
      assets: [
        { id: characterId, name: 'Character', kind: 'character', description: '', image: characterImage },
        { id: sceneId, name: 'Scene', kind: 'scene', description: '', image: sceneImage },
      ],
      shots: [{ ...first, assetIds: [sceneId, characterId], versions: [{
        ...first.versions[0]!, referenceImages: [sceneImage, characterImage],
      }] }],
    }
    const snapshot: ProductionSnapshot = {
      project: current, transfer: null, projectDownload: null, restored: null, capabilityRestorations: [],
      batch: null,
      targets: [{ generator: 'fixture', title: 'Fixture' }], operation: null, error: null, media: {}, mediaLoading: [], mediaErrors: {},
    }
    const value = props({ useProduction: selector => selector(snapshot) })
    render(<VideoProductionView {...value} />)
    const order = () => within(screen.getByRole('list', { name: '参考图顺序' })).getAllByRole('listitem')
    expect(order().map(item => item.querySelector('strong')?.textContent)).toEqual(['Scene', 'Character'])
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Character' }).checked).toBe(true)
    expect(screen.queryByText('输入已修改')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '上移参考图 Character' }))
    expect(order().map(item => item.querySelector('strong')?.textContent)).toEqual(['Character', 'Scene'])
    expect(screen.getByText('输入已修改')).toBeTruthy()
    expect(value.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('保存分镜'))
    const input = vi.mocked(value.save).mock.calls[0]![0]
    expect(input.shots[0]?.assetIds).toEqual([characterId, sceneId])
    expect(input.shots[0]?.selectedVersionId).toBe(VERSION_A)
    expect(input.shots[0]).not.toHaveProperty('versions')
    expect(current.shots[0]?.versions[0]?.referenceImages).toEqual([sceneImage, characterImage])
    expect(value.generate).not.toHaveBeenCalled()
  })

  it('ignores the older canvas cache without changing the Host project', () => {
    const scope = `${SESSION}-old-canvas-cache`
    const oldKey = `dsh.video-production.canvas.${scope}`
    const newKey = `dsh.video-production.workflow-canvas.v1.${scope}`
    const beforeOld = localStorage.getItem(oldKey)
    const beforeNew = localStorage.getItem(newKey)
    const oldValue = JSON.stringify({ positions: { [SHOT_A]: { x: 900, y: 500 } }, zoom: 0.4, selectedShotId: SHOT_A })
    try {
      localStorage.setItem(oldKey, oldValue)
      localStorage.removeItem(newKey)
      const canvas = createVideoCanvasStore().create(scope)
      expect(canvas.getSnapshot()).toEqual({
        positions: {}, viewport: null, selectedNodeIds: [], selectedEdgeIds: [], zoom: 1, selectedShotId: null,
      })
      const value = props({ actions: canvas.actions, useStore: selector => selector(canvas.getSnapshot()) })
      render(<VideoProductionView {...value} />)
      expect(value.save).not.toHaveBeenCalled()
      expect(value.refresh).not.toHaveBeenCalled()
      expect(value.generate).not.toHaveBeenCalled()
      expect(localStorage.getItem(oldKey)).toBe(oldValue)
      canvas.actions.viewport({ x: 25, y: 50, zoom: 0.8 })
      expect(JSON.parse(localStorage.getItem(newKey)!)).toMatchObject({ viewport: { x: 25, y: 50, zoom: 0.8 } })
    } finally {
      if (beforeOld === null) localStorage.removeItem(oldKey)
      else localStorage.setItem(oldKey, beforeOld)
      if (beforeNew === null) localStorage.removeItem(newKey)
      else localStorage.setItem(newKey, beforeNew)
    }
  })

  it('retains viewport, selection and free positions independently of the film sequence', () => {
    const canvas = createVideoCanvasStore().create(SESSION)
    canvas.actions.viewport({ x: -120, y: 40, zoom: 0.7 })
    canvas.actions.selectNodes(['prompt:shot-a'])
    expect(canvas.getSnapshot().viewport).toEqual({ x: -120, y: 40, zoom: 0.7 })
    expect(canvas.getSnapshot().selectedNodeIds).toEqual(['prompt:shot-a'])
    canvas.actions.move(SHOT_A, { x: -10, y: 70 })
    expect(canvas.getSnapshot().positions[SHOT_A]).toEqual({ x: -10, y: 70 })
    canvas.actions.resetLayout()
    expect(canvas.getSnapshot().positions).toEqual({})
    expect(project().shots.map(shot => shot.id)).toEqual([SHOT_A, SHOT_B])
  })
})
