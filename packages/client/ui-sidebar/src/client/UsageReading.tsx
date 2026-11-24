/** Token usage available in the sidebar's Session list. */
import { useMemo } from 'react'
import { IconDatabaseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import css from './UsageReading.module.css'

type UsageReadingProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'sidebar'>

function compactCount(value: number, t: UsageReadingProps['t']): string {
  if (value < 1_000) return String(value)
  const millions = value >= 1_000_000
  const scaled = value / (millions ? 1_000_000 : 1_000)
  const magnitude = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10
  return t(millions ? 'number.million' : 'number.thousand', { value: magnitude })
}

/** Render the reported token total and weighted cache hit share in the expanded sidebar.
 * @param props - Footer width, Session list hook, and sidebar dictionary.
 * @returns The usage reading, or null when the sidebar is collapsed or has no reported usage.
 */
export function UsageReading({ wide, useSessions, t }: UsageReadingProps) {
  const ids = useSessions(state => state.ids)
  const byId = useSessions(state => state.byId)
  const reading = useMemo(() => {
    if (!wide) return null
    let total = 0
    let input = 0
    let cacheRead = 0
    let sessions = 0
    for (const id of ids) {
      const usage = byId[id]?.projectionValues?.tokenUsage
      if (usage === undefined) continue
      const prompt = usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
      const tokens = prompt + usage.outputTokens
      if (tokens === 0) continue
      total += tokens
      input += prompt
      cacheRead += usage.cacheReadTokens
      sessions += 1
    }
    return { total, input, cacheRead, sessions }
  }, [wide, ids, byId])
  if (reading === null || reading.total === 0) return null

  const { total, input, cacheRead, sessions } = reading
  const separator = t('usage.groupSeparator')
  const count = String(total).replace(/\B(?=(\d{3})+(?!\d))/g, () => separator)
  const title = t(sessions === 1 ? 'usage.title.one' : 'usage.title.other', { count, sessions })
  const totalText = t('usage.tokens', { count: compactCount(total, t) })
  const cacheHit = input === 0 ? null : cacheRead === input ? 100 : Math.min(99, Math.round(cacheRead / input * 100))
  const cacheText = cacheHit === null ? null : t('usage.cacheHit', { percent: cacheHit })
  return (
    <div className={css.row} title={title} data-sidebar-usage>
      <IconDatabaseOutlineRegular />
      <span>{cacheText === null ? totalText : `${totalText} · ${cacheText}`}</span>
    </div>
  )
}
