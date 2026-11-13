// @vitest-environment jsdom

import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { AttachmentId, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  VideoProjectTransferId, VideoMediaChunk, VideoProject, VideoBatch, VideoBatchId,
} from '@deepseek-ai/dsh-video-production/types'
import { ProductionController, type ProductionRemote } from '../src/client/controller.ts'
import { project, SESSION, SHOT_A, VIDEO } from './fixtures.ts'

function missingProject(): VideoProject {
  const value = project()
  return {
    ...value,
    shots: value.shots.map(({ selectedVersionId: _selected, ...shot }) => ({ ...shot, versions: [] })),
  }
}

function batch(): VideoBatch {
  return {
    id: 'batch-test' as VideoBatchId, sessionId: SESSION, sessionCreatedAt: 1,
    projectId: project().id, inputRevision: 1, generator: 'fixture', status: 'running',
    shots: [{ shotId: SHOT_A, input: '{}', status: 'pending' }],
  }
}

function remote(overrides: Partial<ProductionRemote> = {}): ProductionRemote {
  return {
    startBatch: async () => batch(), batch: async () => null,
    pauseBatch: async () => ({ ...batch(), status: 'paused' }),
    cancelBatch: async () => ({ ...batch(), status: 'cancelled' }),
    resumeBatch: async () => batch(),
    restoreCapabilities: async () => [],
    prepareProjectExport: async () => ({ id: 'transfer' as VideoProjectTransferId, direction: 'export', bytes: 4, nextOffset: 0, expiresAt: 1, fileName: 'project.dshvideo' }),
    readProjectTransfer: async () => ({ data: btoa('test'), offset: 0, nextOffset: 4, totalBytes: 4 }),
    beginProjectImport: async bytes => ({ id: 'transfer' as VideoProjectTransferId, direction: 'import', bytes, nextOffset: 0, expiresAt: 1, fileName: 'project.dshvideo' }),
    writeProjectTransfer: async (_id, offset, data) => ({ id: 'transfer' as VideoProjectTransferId, direction: 'import', bytes: 4, nextOffset: offset + atob(data).length, expiresAt: 1, fileName: 'project.dshvideo' }),
    commitProjectImport: async () => ({ project: project(), requirements: [] }),
    cancelProjectTransfer: async () => {},
    generationTargets: async () => [{ generator: 'fixture', title: 'Fixture' }],
    view: async () => project(), update: async () => project(), generate: async () => project(),
    reorder: async () => project(), export: async () => project(), addAsset: async () => project(),
    readMedia: async (_projectId, _attachmentId, offset) => ({
      attachment: VIDEO, offset, nextOffset: 4, totalBytes: 4, data: btoa('test'.slice(offset)),
    }),
    ...overrides,
  }
}

async function ready(
  overrides: Partial<ProductionRemote> = {},
  urls: { create(blob: Blob): string; revoke(url: string): void } = { create: vi.fn(() => 'blob:video-preview'), revoke: vi.fn() },
) {
  const controller = new ProductionController(remote(overrides), urls)
  onTestFinished(() => controller.dispose())
  const face = controller.inject()
  face.refresh()
  await vi.waitFor(() => { expect(face.hooks.production.getSnapshot().project).not.toBeNull() })
  return { controller, face, state: () => face.hooks.production.getSnapshot() }
}

describe('video project controller', () => {
  it('waits for a late export ticket and its cancellation before disposal completes', async () => {
    const prepared = Promise.withResolvers<Awaited<ReturnType<ProductionRemote['prepareProjectExport']>>>()
    const cancelled = Promise.withResolvers<undefined>()
    const prepareProjectExport = vi.fn<ProductionRemote['prepareProjectExport']>(() => prepared.promise)
    const cancelProjectTransfer = vi.fn(() => cancelled.promise)
    const { controller, face } = await ready({ prepareProjectExport, cancelProjectTransfer })
    face.exportProject()
    const settled = vi.fn()
    const disposing = controller.dispose().then(settled)
    expect(prepareProjectExport.mock.calls[0]?.[0].aborted).toBe(true)
    prepared.resolve(await remote().prepareProjectExport(new AbortController().signal))
    await vi.waitFor(() => { expect(cancelProjectTransfer).toHaveBeenCalledExactlyOnceWith('transfer') })
    expect(settled).not.toHaveBeenCalled()
    cancelled.resolve(undefined)
    await disposing
    expect(settled).toHaveBeenCalledOnce()
    expect(face.hooks.production.getSnapshot().projectDownload).toBeNull()
  })

  it('downloads ordered package chunks and releases the Host ticket and owned Blob URL', async () => {
    const readProjectTransfer = vi.fn<ProductionRemote['readProjectTransfer']>(async (_id, offset) => ({
      offset, nextOffset: offset + 2, totalBytes: 4, data: btoa(offset === 0 ? 'ab' : 'cd'),
    }))
    const cancelProjectTransfer = vi.fn(async () => {})
    const urls = { create: vi.fn<(blob: Blob) => string>(() => 'blob:project-package'), revoke: vi.fn() }
    const { face, state, controller } = await ready({ readProjectTransfer, cancelProjectTransfer }, urls)
    face.exportProject()
    await vi.waitFor(() => { expect(state().operation).toBeNull() })
    expect(readProjectTransfer.mock.calls.map(call => [call[1], call[2]])).toEqual([[0, 262144], [2, 262144]])
    expect(urls.create.mock.calls[0]?.[0]).toMatchObject({ size: 4, type: 'application/octet-stream' })
    expect(state().projectDownload).toEqual({ url: 'blob:project-package', fileName: 'project.dshvideo' })
    expect(cancelProjectTransfer).toHaveBeenCalledExactlyOnceWith('transfer')
    await controller.dispose()
    expect(urls.revoke).toHaveBeenCalledWith('blob:project-package')
  })

  it('rejects corrupt package offsets without publishing a partial download', async () => {
    const cancelProjectTransfer = vi.fn(async () => {})
    const { face, state } = await ready({
      readProjectTransfer: async () => ({ offset: 0, nextOffset: 3, totalBytes: 4, data: btoa('ab') }), cancelProjectTransfer,
    })
    face.exportProject()
    await vi.waitFor(() => { expect(state().operation).toBeNull() })
    expect(state().error).toContain('invalid byte offsets')
    expect(state().projectDownload).toBeNull()
    expect(cancelProjectTransfer).toHaveBeenCalledOnce()
  })

  it('uploads only to an empty Session and keeps capability restoration an explicit separate operation', async () => {
    const empty = { ...project(), revision: 0, shots: [], assets: [], exports: [] }
    const capabilities = { format: 'dsh-capabilities' as const, version: 1 as const, capabilities: [] }
    const restoreCapabilities = vi.fn(async () => [])
    const cancelProjectTransfer = vi.fn(async () => {})
    const writeProjectTransfer = vi.fn<ProductionRemote['writeProjectTransfer']>((...args) => remote().writeProjectTransfer(...args))
    const commitProjectImport = vi.fn(async () => ({ project: project(), requirements: [], capabilities }))
    const { face, state } = await ready({ view: async () => empty, writeProjectTransfer, commitProjectImport,
      cancelProjectTransfer, restoreCapabilities })
    const file = { size: 4, slice: () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }) } as File
    face.importProject(file)
    await vi.waitFor(() => { expect(state().operation).toBeNull() })
    expect(writeProjectTransfer.mock.calls[0]?.slice(0, 3)).toEqual(['transfer', 0, 'AQIDBA=='])
    expect(state().project?.revision).toBe(1)
    expect(restoreCapabilities).not.toHaveBeenCalled()
    expect(cancelProjectTransfer).not.toHaveBeenCalled()
    face.restoreCapabilities()
    await vi.waitFor(() => { expect(state().operation).toBeNull() })
    expect(restoreCapabilities).toHaveBeenCalledOnce()
    face.importProject(file)
    await vi.waitFor(() => { expect(state().operation).toBeNull() })
    expect(state().error).toContain('empty current Session')
    expect(commitProjectImport).toHaveBeenCalledOnce()
  })

  it('cancels an upload before a pending file read can send another chunk', async () => {
    const empty = { ...project(), revision: 0, shots: [], assets: [], exports: [] }
    const pending = Promise.withResolvers<ArrayBuffer>()
    const beginProjectImport = vi.fn<ProductionRemote['beginProjectImport']>((...args) => remote().beginProjectImport(...args))
    const writeProjectTransfer = vi.fn<ProductionRemote['writeProjectTransfer']>((...args) => remote().writeProjectTransfer(...args))
    const commitProjectImport = vi.fn<ProductionRemote['commitProjectImport']>((...args) => remote().commitProjectImport(...args))
    const cancelProjectTransfer = vi.fn(async () => {})
    const { face, state } = await ready({ view: async () => empty, beginProjectImport, writeProjectTransfer,
      commitProjectImport, cancelProjectTransfer })
    face.importProject({ size: 4, slice: () => ({ arrayBuffer: () => pending.promise }) } as File)
    await vi.waitFor(() => { expect(beginProjectImport).toHaveBeenCalledOnce() })
    face.cancel()
    pending.resolve(new Uint8Array(4).buffer)
    await vi.waitFor(() => { expect(state().operation).toBeNull() })
    expect(writeProjectTransfer).not.toHaveBeenCalled()
    expect(commitProjectImport).not.toHaveBeenCalled()
    expect(cancelProjectTransfer).toHaveBeenCalledOnce()
    expect(state().project?.revision).toBe(0)
  })

  it('starts one Host batch with captured selection without generating browser-owned shots', async () => {
    const startBatch = vi.fn<ProductionRemote['startBatch']>(async () => batch())
    const generate = vi.fn<ProductionRemote['generate']>(async () => project())
    const { face, state } = await ready({ view: async () => missingProject(), startBatch, generate })
    const selection = { generator: 'provider-a', model: 'model-a' }
    face.generateMissing(selection)
    selection.model = 'model-b'
    await vi.waitFor(() => { expect(state().operation).toBeNull() })
    expect(startBatch).toHaveBeenCalledExactlyOnceWith({ generator: 'provider-a', model: 'model-a', revision: 1 })
    expect(state().batch?.status).toBe('running')
    expect(generate).not.toHaveBeenCalled()
  })

  it('forwards pause, resume and cancellation to the observed Host batch identity', async () => {
    const pauseBatch = vi.fn<ProductionRemote['pauseBatch']>(async () => ({ ...batch(), status: 'paused' }))
    const resumeBatch = vi.fn<ProductionRemote['resumeBatch']>(async () => batch())
    const cancelBatch = vi.fn<ProductionRemote['cancelBatch']>(async () => ({ ...batch(), status: 'cancelled' }))
    const { face, state } = await ready({ batch: async () => batch(), pauseBatch, resumeBatch, cancelBatch })
    face.pauseBatch()
    await vi.waitFor(() => { expect(state().batch?.status).toBe('paused') })
    face.resumeBatch()
    await vi.waitFor(() => { expect(state().batch?.status).toBe('running') })
    face.cancelBatch()
    await vi.waitFor(() => { expect(state().batch?.status).toBe('cancelled') })
    for (const action of [pauseBatch, resumeBatch, cancelBatch]) expect(action).toHaveBeenCalledExactlyOnceWith(batch().id)
  })

  it('discards late admission replies on disconnect and never cancels Host batch ownership', async () => {
    const pending = Promise.withResolvers<VideoBatch>()
    const startBatch = vi.fn<ProductionRemote['startBatch']>(() => pending.promise)
    const cancelBatch = vi.fn<ProductionRemote['cancelBatch']>(async () => batch())
    const { face, state, controller } = await ready({ startBatch, cancelBatch })
    face.generateMissing()
    await vi.waitFor(() => { expect(startBatch).toHaveBeenCalledOnce() })
    controller.resetConnection()
    pending.resolve(batch())
    await controller.dispose()
    expect(state().batch).toBeNull()
    expect(state().project).toBeNull()
    expect(cancelBatch).not.toHaveBeenCalled()
  })

  it('observes batches with one request at a time and awaits stale reads on disposal', async () => {
    vi.useFakeTimers()
    const pending = Promise.withResolvers<VideoBatch | null>()
    const readBatch = vi.fn<ProductionRemote['batch']>().mockResolvedValueOnce(batch()).mockImplementation(() => pending.promise)
    const cancelBatch = vi.fn<ProductionRemote['cancelBatch']>(async () => batch())
    const controller = new ProductionController(remote({ batch: readBatch, cancelBatch }), undefined, undefined, 100)
    try {
      const face = controller.inject()
      face.refresh()
      await vi.advanceTimersByTimeAsync(100)
      expect(readBatch).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1000)
      expect(readBatch).toHaveBeenCalledTimes(2)
      controller.resetConnection()
      const settled = vi.fn()
      const disposing = controller.dispose().then(settled)
      await vi.advanceTimersByTimeAsync(1000)
      expect(settled).not.toHaveBeenCalled()
      pending.resolve({ ...batch(), status: 'completed' })
      await disposing
      expect(face.hooks.production.getSnapshot().batch).toBeNull()
      expect(cancelBatch).not.toHaveBeenCalled()
    } finally {
      pending.resolve(null)
      await controller.dispose()
      vi.useRealTimers()
    }
  })
  it('does not let an older batch observation replace a newer project save', async () => {
    vi.useFakeTimers()
    const pending = Promise.withResolvers<VideoProject>()
    const updated = { ...project(), revision: 2, title: 'Saved during observation' }
    const view = vi.fn<ProductionRemote['view']>().mockResolvedValueOnce(project()).mockImplementation(() => pending.promise)
    const controller = new ProductionController(remote({ view, batch: async () => batch(), update: async () => updated }),
      undefined, undefined, 100)
    try {
      const face = controller.inject()
      face.refresh()
      await vi.advanceTimersByTimeAsync(100)
      expect(view).toHaveBeenCalledTimes(2)
      face.save({ revision: 1, title: updated.title, assets: [], shots: [] })
      await vi.advanceTimersByTimeAsync(0)
      expect(face.hooks.production.getSnapshot().project?.revision).toBe(2)
      pending.resolve(project())
      await vi.advanceTimersByTimeAsync(0)
      expect(face.hooks.production.getSnapshot().project?.title).toBe(updated.title)
    } finally {
      pending.resolve(project())
      await controller.dispose()
      vi.useRealTimers()
    }
  })

  it('loads and retains reference images owned by historical versions after current assets are removed', async () => {
    const image: ImageAttachmentRef = {
      attachmentId: 'historical-reference' as AttachmentId, mediaType: 'image/png', bytes: 4, width: 1, height: 1,
    }
    const initial = project()
    const historical = {
      ...initial, assets: [],
      shots: initial.shots.map(shot => ({
        ...shot, versions: shot.versions.map(version => ({ ...version, referenceImages: [image] })),
      })),
    }
    const urls = { create: vi.fn(() => 'blob:historical-reference'), revoke: vi.fn() }
    const readMedia = vi.fn<ProductionRemote['readMedia']>(async (_projectId, _attachmentId, offset) => ({
      attachment: image, offset, nextOffset: 4, totalBytes: 4, data: btoa('test'),
    }))
    const { face, state } = await ready({
      view: async () => historical, readMedia, update: async () => ({ ...historical, revision: 2 }),
    }, urls)
    face.loadMedia(image)
    await vi.waitFor(() => { expect(state().media[image.attachmentId]).toBe('blob:historical-reference') })
    face.save({ revision: 1, title: historical.title, assets: [], shots: [] })
    await vi.waitFor(() => { expect(state().project?.revision).toBe(2) })
    expect(readMedia).toHaveBeenCalledOnce()
    expect(urls.revoke).not.toHaveBeenCalled()
  })

  it('prevents a competing mutation and forwards cancellation to the active generation', async () => {
    let generationSignal: AbortSignal | undefined
    const reorder = vi.fn(async () => project())
    const { controller, face, state } = await ready({
      generate: (_shot, _selection, signal) => new Promise((_resolve, reject) => {
        generationSignal = signal
        signal.addEventListener('abort', () => { reject(new Error('generation cancelled')) }, { once: true })
      }),
      reorder,
    })
    face.generate(SHOT_A)
    face.reorder([SHOT_A])
    expect(state().operation).toEqual({ kind: 'generate', shotId: SHOT_A })
    expect(reorder).not.toHaveBeenCalled()
    face.cancel()
    expect(generationSignal?.aborted).toBe(true)
    await vi.waitFor(() => { expect(state().operation).toBeNull() })
    expect(state().error).toBe('generation cancelled')
    await controller.dispose()
  })

  it('ignores a load that settles after a connection reset', async () => {
    let settle: ((value: VideoProject) => void) | undefined
    const controller = new ProductionController(remote({ view: () => new Promise((resolve) => { settle = resolve }) }))
    onTestFinished(() => controller.dispose())
    const face = controller.inject()
    face.refresh()
    controller.resetConnection()
    settle!(project())
    await Promise.resolve()
    await Promise.resolve()
    expect(face.hooks.production.getSnapshot()).toMatchObject({ project: null, operation: null })
    await controller.dispose()
  })

  it('coalesces media reads, assembles byte slices, and revokes the URL on disposal', async () => {
    const createObjectURL = vi.fn(() => 'blob:video-preview')
    const revokeObjectURL = vi.fn()
    const readMedia = vi.fn<ProductionRemote['readMedia']>(async (_projectId, _attachmentId, offset) => ({
      attachment: VIDEO, offset, nextOffset: offset + 2, totalBytes: 4,
      data: btoa(offset === 0 ? 'te' : 'st'),
    }))
    const { controller, face, state } = await ready({ readMedia }, { create: createObjectURL, revoke: revokeObjectURL })
    face.loadMedia(VIDEO)
    face.loadMedia(VIDEO)
    await vi.waitFor(() => { expect(state().media[VIDEO.attachmentId]).toBe('blob:video-preview') })
    expect(readMedia.mock.calls.map(call => call[2])).toEqual([0, 2])
    expect(createObjectURL).toHaveBeenCalledOnce()
    face.loadMedia(VIDEO)
    expect(readMedia).toHaveBeenCalledTimes(2)
    await controller.dispose()
    await controller.dispose()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:video-preview')
  })

  it('rejects a media slice that would stall the reader instead of publishing a preview', async () => {
    const createObjectURL = vi.fn()
    const { controller, face, state } = await ready({
      readMedia: async (): Promise<VideoMediaChunk> => ({
        attachment: VIDEO, offset: 0, nextOffset: 0, totalBytes: 4, data: '',
      }),
    }, { create: createObjectURL, revoke: vi.fn() })
    face.loadMedia(VIDEO)
    await vi.waitFor(() => { expect(state().mediaErrors[VIDEO.attachmentId]).toContain('inconsistent byte offsets') })
    expect(state().media).toEqual({})
    expect(state().mediaLoading).toEqual([])
    expect(createObjectURL).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it('does not publish a media URL when the plugin unloads during a read', async () => {
    const createObjectURL = vi.fn()
    let settle: ((chunk: VideoMediaChunk) => void) | undefined
    const { controller, face } = await ready(
      { readMedia: () => new Promise((resolve) => { settle = resolve }) },
      { create: createObjectURL, revoke: vi.fn() },
    )
    face.loadMedia(VIDEO)
    const disposing = controller.dispose()
    settle!({ attachment: VIDEO, offset: 0, nextOffset: 4, totalBytes: 4, data: btoa('test') })
    await disposing
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('releases a preview when an update removes its last project reference', async () => {
    const urls = { create: vi.fn(() => 'blob:video-preview'), revoke: vi.fn() }
    const removed = { ...project(), revision: 2, shots: [] }
    const { face, state } = await ready({ update: async () => removed }, urls)
    face.loadMedia(VIDEO)
    await vi.waitFor(() => { expect(state().media[VIDEO.attachmentId]).toBe('blob:video-preview') })
    face.save({ revision: 1, title: removed.title, assets: [], shots: [] })
    await vi.waitFor(() => { expect(state().project?.revision).toBe(2) })
    expect(state().media).toEqual({})
    expect(urls.revoke).toHaveBeenCalledExactlyOnceWith('blob:video-preview')
  })

  it('does not publish a pending preview after its shot is deleted', async () => {
    const urls = { create: vi.fn(() => 'blob:video-preview'), revoke: vi.fn() }
    let settle: ((chunk: VideoMediaChunk) => void) | undefined
    const removed = { ...project(), revision: 2, shots: [] }
    const { face, state } = await ready({
      update: async () => removed,
      readMedia: () => new Promise((resolve) => { settle = resolve }),
    }, urls)
    face.loadMedia(VIDEO)
    face.save({ revision: 1, title: removed.title, assets: [], shots: [] })
    await vi.waitFor(() => { expect(state().project?.revision).toBe(2) })
    settle!({ attachment: VIDEO, offset: 0, nextOffset: 4, totalBytes: 4, data: btoa('test') })
    await Promise.resolve()
    expect(urls.create).not.toHaveBeenCalled()
    expect(state().mediaLoading).toEqual([])
  })
})
