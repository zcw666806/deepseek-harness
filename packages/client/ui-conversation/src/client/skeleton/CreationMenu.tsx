/** Selects a project workflow in the composer. */
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { StudioKind, StudioNavigation } from '@deepseek-ai/dsh-client-ui-layout/client'
import { IconChevronDownOutline14, IconListPenOutline16, IconPlayOutline16, IconSparkle16, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './InputBar.module.css'

function menuButtons(listId: string): HTMLButtonElement[] {
  return Array.from(document.getElementById(listId)?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? [])
}

/**
 * Offer the project workflows installed in the current profile.
 * @param props - available modes, the current selection, and composer availability.
 * @returns The project mode picker beside the conversation controls.
 */
export function CreationMenu({ navigation, selected, select, chatLabel, disabled }: {
  readonly navigation: StudioNavigation
  readonly selected: StudioKind | null
  readonly select: (kind: StudioKind | null) => void
  readonly chatLabel: string
  readonly disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const initialFocus = useRef<number | null>(null)
  const expanded = open && !disabled
  useEffect(() => {
    if (disabled) {
      initialFocus.current = null
      setOpen(false)
    }
    if (!expanded || initialFocus.current === null) return
    const index = initialFocus.current
    const frame = requestAnimationFrame(() => {
      menuButtons(listId).at(index)?.focus()
      initialFocus.current = null
    })
    return () => { cancelAnimationFrame(frame) }
  }, [disabled, expanded, listId])
  const items = [
    ...navigation.entries.map(({ kind, label }) => ({
      id: kind,
      label,
      icon: kind === 'comic' ? <IconListPenOutline16 /> : <IconPlayOutline16 />,
    })),
    ...(selected === null ? [] : [
      { id: 'regular-chat', label: chatLabel },
      { id: 'existing-projects', label: navigation.existingLabel },
    ]),
  ]
  const activeLabel = navigation.entries.find(entry => entry.kind === selected)?.label
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && expanded) {
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
      return
    }
    if (disabled || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
    event.preventDefault()
    event.stopPropagation()
    const forward = event.key === 'ArrowDown'
    if (!expanded) {
      initialFocus.current = forward ? 0 : -1
      setOpen(true)
      return
    }
    const buttons = menuButtons(listId)
    const focused = buttons.findIndex(button => button === event.target)
    const next = focused === -1 ? (forward ? 0 : -1) : (focused + (forward ? 1 : -1)) % buttons.length
    buttons.at(next)?.focus()
  }
  return (
    <div className={css.creationMenu} onKeyDown={navigate}>
      <Menu
        open={expanded}
        side="top"
        portal
        listId={listId}
        items={items}
        selectedId={selected ?? undefined}
        onClose={() => { setOpen(false) }}
        onSelect={(id) => {
          if (disabled) return
          setOpen(false)
          trigger.current?.focus()
          if (id === 'regular-chat') select(null)
          else if (id === 'existing-projects' && selected !== null) navigation.openExisting(selected)
          else {
            const entry = navigation.entries.find(({ kind }) => kind === id)
            if (entry !== undefined) select(entry.kind)
          }
        }}
        anchor={(
          <button ref={trigger} type="button" className={css.creationTrigger}
            aria-label={activeLabel ?? navigation.label}
            data-active={selected === null ? undefined : ''}
            aria-haspopup="menu" aria-expanded={expanded} aria-controls={expanded ? listId : undefined} disabled={disabled}
            onClick={() => {
              if (!expanded) initialFocus.current = 0
              setOpen(value => !value)
            }}>
            <IconSparkle16 size={14} />
            {activeLabel ?? navigation.label}
            <IconChevronDownOutline14 />
          </button>
        )}
      />
    </div>
  )
}
