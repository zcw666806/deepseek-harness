/** Project directory rebuilds from Host metadata and rejects stale asynchronous publication. */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { VideoProjectSummary } from '@deepseek-ai/dsh-video-production/types'
import { ProjectDirectory, type ProjectSummaryReader } from '../src/client/project-directory.ts'
import { project, SESSION } from './fixtures.ts'

function summary(title = 'Saved project', revision = 1): VideoProjectSummary {
  return { sessionId: SESSION, projectId: project().id, revision, displayTitle: title }
}
function directory(read: ProjectSummaryReader) {
  const value = new ProjectDirectory(read)
  onTestFinished(() => value.dispose())
  return value
}

describe('video project directory', () => {
  it('rebuilds a fresh index from Host metadata in batches of at most 256 unique Sessions', async () => {
    const ids = Array.from({ length: 513 }, (_, index) => `session-${index}` as SessionId)
    const read = vi.fn<ProjectSummaryReader>(async batch => batch.map(id => ({ ...summary(), sessionId: id })))
    const value = directory(read)
    value.refresh([...ids, ids[0]!])
    await vi.waitFor(() => { expect(value.source.getSnapshot()).toHaveLength(513) })
    expect(read.mock.calls.map(call => call[0].length)).toEqual([256, 256, 1])
    expect(new Set(read.mock.calls.flatMap(call => call[0])).size).toBe(513)
  })

  it.each([{ result: [] }, { result: [summary('Old project')] }])('keeps a committed response when an older query returns $result', async ({ result }) => {
    const pending = Promise.withResolvers<readonly VideoProjectSummary[]>()
    const value = directory(() => pending.promise)
    value.refresh([SESSION])
    value.observe({ ...project(), title: 'Just restored', revision: 5 })
    pending.resolve(result)
    await pending.promise
    expect(value.source.getSnapshot()).toEqual([summary('Just restored', 5)])
  })

  it('clears connection metadata and ignores the old generation when rebuilding', async () => {
    const old = Promise.withResolvers<readonly VideoProjectSummary[]>()
    const read = vi.fn<ProjectSummaryReader>().mockImplementationOnce(() => old.promise).mockResolvedValueOnce([summary('New Host')])
    const value = directory(read)
    value.refresh([SESSION])
    value.reset()
    expect(read.mock.calls[0]?.[1].aborted).toBe(true)
    value.refresh([SESSION])
    await vi.waitFor(() => { expect(value.source.getSnapshot()).toEqual([summary('New Host')]) })
    old.resolve([summary('Previous Host')])
    await old.promise
    expect(value.source.getSnapshot()).toEqual([summary('New Host')])
  })

  it('retains the last authoritative directory on a failed read and removes absent Sessions on a successful refresh', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() =>{  warn.mockRestore() })
    const read = vi.fn<ProjectSummaryReader>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
    const value = directory(read)
    value.observe(project())
    value.refresh([SESSION])
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledOnce() })
    expect(value.source.getSnapshot()).toHaveLength(1)
    value.refresh([SESSION])
    await vi.waitFor(() => { expect(value.source.getSnapshot()).toHaveLength(0) })
  })

  it('waits for an admitted query during disposal and never publishes its late result', async () => {
    const pending = Promise.withResolvers<readonly VideoProjectSummary[]>()
    const value = directory(() => pending.promise)
    value.refresh([SESSION])
    const finished = vi.fn()
    const disposing = value.dispose().then(finished)
    expect(finished).not.toHaveBeenCalled()
    pending.resolve([summary()])
    await disposing
    expect(finished).toHaveBeenCalledOnce()
    expect(value.source.getSnapshot()).toEqual([])
  })
})
