// @vitest-environment jsdom
/** Sidebar token total: which listed sessions count, and how the compact reading is written. */
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { allowAllAccess, contextMenuHook, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { cleanup, render, type RenderResult } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { en } from '../src/client/locales.ts'
import { UsageReading } from '../src/client/UsageReading.tsx'

const t = makeTranslate(en, commonEn)
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
const neverHook = (() => { throw new Error('usage row must not read this hook') }) as never

afterEach(() => { cleanup() })

function tokens(partial: Partial<TokenUsageProjection>): TokenUsageProjection {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...partial }
}

function summary(name: string, usage?: TokenUsageProjection): SessionSummary {
  return {
    id: SessionId(name),
    displayTitle: name,
    running: false,
    blank: false,
    updatedAt: 1,
    retainedBy: {},
    ...(usage === undefined ? {} : { projectionValues: { tokenUsage: usage } }),
  }
}

function list(rows: readonly SessionSummary[], missingIds: readonly string[] = []): SessionListState {
  const byId: SessionListState['byId'] = {}
  for (const row of rows) byId[row.id] = row
  return {
    ids: [...rows.map(row => row.id), ...missingIds.map(id => SessionId(id))],
    byId,
    phase: 'ready',
    projectionsBySession: {},
  }
}

function mount(wide: boolean, sessions: SessionListState): RenderResult {
  return render(
    <UsageReading
      wide={wide}
      useSessions={selector => selector(sessions)}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
      usePanelInfo={usePanelInfo}
      useContextMenu={contextMenuHook()}
      useResource={useResource}
      useWorkspaces={neverHook}
      {...allowAllAccess}
      t={t}
    />,
  )
}

function reading(view: RenderResult): HTMLElement | null {
  const row = view.container.querySelector('[data-sidebar-usage]')
  return row instanceof HTMLElement ? row : null
}

const ignored = [
  summary('no-usage'),
  { ...summary('no-tokens'), projectionValues: {} },
  summary('zero', tokens({})),
]

describe('sidebar token usage', () => {
  it('hides the row when the sidebar is collapsed or no listed session reports tokens', () => {
    const reported = list([summary('one', tokens({ uncachedInputTokens: 40, cacheReadTokens: 40, outputTokens: 20 }))])
    expect(reading(mount(false, reported))).toBeNull()
    expect(reading(mount(true, list([])))).toBeNull()
    expect(reading(mount(true, list([...ignored], ['missing'])))).toBeNull()
  })

  it('shows one session’s exact total and the share of input read from cache', () => {
    const view = mount(true, list([
      summary('one', tokens({ uncachedInputTokens: 40, cacheReadTokens: 40, outputTokens: 20 })),
    ]))
    const row = reading(view)
    expect(row?.textContent).toBe('100 tok · Cache hit 50%')
    expect(row?.title).toBe('Token usage across 1 session (100 tok)')
  })

  it('omits the cache share when the reported tokens are all output', () => {
    const view = mount(true, list([summary('output', tokens({ outputTokens: 7 }))]))
    const row = reading(view)
    expect(row?.textContent).toBe('7 tok')
    expect(row?.title).toBe('Token usage across 1 session (7 tok)')
  })

  it('compacts thousands and millions and caps a near-complete cache hit at 99%', () => {
    const cases = [
      { usage: tokens({ uncachedInputTokens: 1_500 }), text: '1.5K tok · Cache hit 0%', title: 'Token usage across 1 session (1,500 tok)' },
      { usage: tokens({ uncachedInputTokens: 150_000 }), text: '150K tok · Cache hit 0%', title: 'Token usage across 1 session (150,000 tok)' },
      { usage: tokens({ uncachedInputTokens: 1_500_000 }), text: '1.5M tok · Cache hit 0%', title: 'Token usage across 1 session (1,500,000 tok)' },
      { usage: tokens({ uncachedInputTokens: 150_000_000 }), text: '150M tok · Cache hit 0%', title: 'Token usage across 1 session (150,000,000 tok)' },
      { usage: tokens({ cacheReadTokens: 1_000 }), text: '1K tok · Cache hit 100%', title: 'Token usage across 1 session (1,000 tok)' },
      { usage: tokens({ uncachedInputTokens: 5, cacheReadTokens: 995 }), text: '1K tok · Cache hit 99%', title: 'Token usage across 1 session (1,000 tok)' },
    ]
    for (const [index, item] of cases.entries()) {
      const view = mount(true, list([summary(`case-${index}`, item.usage)]))
      const row = reading(view)
      expect(row?.textContent).toBe(item.text)
      expect(row?.title).toBe(item.title)
      view.unmount()
    }
  })

  it('adds every listed session and names the plural total', () => {
    const view = mount(true, list([
      ...ignored,
      summary('output', tokens({ outputTokens: 500 })),
      summary('cached', tokens({ uncachedInputTokens: 400, cacheReadTokens: 200 })),
    ], ['missing']))
    const row = reading(view)
    expect(row?.textContent).toBe('1.1K tok · Cache hit 33%')
    expect(row?.title).toBe('Token usage across 2 sessions (1,100 tok)')
  })
})
