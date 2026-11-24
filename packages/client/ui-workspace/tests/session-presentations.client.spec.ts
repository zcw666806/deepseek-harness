import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceSessionPresentation } from '../src/client/contract/presentations.ts'
import { SessionPresentationDirectory } from '../src/client/session-presentations.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const row = (id: string, displayTitle: string): WorkspaceSessionPresentation => ({ sessionId: id as SessionId, displayTitle })

function source(initial: readonly WorkspaceSessionPresentation[]) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next: readonly WorkspaceSessionPresentation[]) { value = next; for (const listener of [...listeners]) listener() },
    listeners,
  }
}

describe('feature Session presentation directory', () => {
  it('keeps first-registration title precedence while merging independent feature sources', () => {
    const directory = new SessionPresentationDirectory()
    const first = source([row('one', 'First project')])
    const second = source([row('one', 'Another title'), row('two', 'Second project')])
    const removeFirst = directory.register(first)
    const removeSecond = directory.register(second)
    expect(directory.snapshot.getSnapshot()).toEqual([row('one', 'First project'), row('two', 'Second project')])
    first.set([row('one', 'Renamed project')])
    expect(directory.snapshot.getSnapshot()[0]?.displayTitle).toBe('Renamed project')
    removeFirst()
    expect(first.listeners.size).toBe(0)
    expect(directory.snapshot.getSnapshot()).toEqual([row('one', 'Another title'), row('two', 'Second project')])
    removeSecond()
    expect(directory.snapshot.getSnapshot()).toEqual([])
  })

  it('publishes changed rows synchronously and keeps unchanged aggregate identity stable', () => {
    const directory = new SessionPresentationDirectory()
    const feature = source([row('one', 'Project')])
    const remove = directory.register(feature)
    const before = directory.snapshot.getSnapshot()
    const notify = vi.fn()
    const unsubscribe = directory.snapshot.subscribe(notify)
    feature.set([row('one', 'Project')])
    expect(directory.snapshot.getSnapshot()).toBe(before)
    expect(notify).not.toHaveBeenCalled()
    feature.set([])
    expect(notify).toHaveBeenCalledOnce()
    expect(directory.snapshot.getSnapshot()).toEqual([])
    remove()
    unsubscribe()
  })

  it('drops subscriptions on teardown and permits fresh feature registration after an unload', () => {
    const directory = new SessionPresentationDirectory()
    const feature = source([row('one', 'Original')])
    const remove = directory.register(feature)
    directory.clear()
    expect(feature.listeners.size).toBe(0)
    feature.set([row('one', 'Late value')])
    expect(directory.snapshot.getSnapshot()).toEqual([])
    remove()
    const next = source([row('one', 'Replacement')])
    directory.register(next)
    expect(directory.snapshot.getSnapshot()).toEqual([row('one', 'Replacement')])
    directory.clear()
  })
})
