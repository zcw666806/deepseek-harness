/** A compact, single-choice menu for toolbar controls. */
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { IconChevronDownOutline14 } from './icons/index.tsx'
import { Menu } from './Menu.tsx'
import css from './ChoiceMenu.module.css'

interface ChoiceMenuProps {
  readonly label: string
  readonly value?: string | undefined
  readonly placeholder: string
  readonly options: readonly { readonly id: string; readonly label: string; readonly detail?: string | undefined }[]
  readonly selectedId?: string | undefined
  readonly busy?: boolean
  readonly onSelect: (id: string) => void
}

function optionButtons(listId: string): HTMLButtonElement[] {
  const list = document.getElementById(listId)
  return Array.from(list?.querySelectorAll<HTMLButtonElement>('button[role="menuitemradio"]') ?? [])
}

/**
 * Show a controlled current choice and make available options reachable by keyboard and pointer.
 * @param props - Localized trigger copy, current choice, options, and selection handler.
 * @returns A toolbar trigger and its viewport-constrained menu.
 */
export function ChoiceMenu({ label, value, placeholder, options, selectedId, busy = false, onSelect }: ChoiceMenuProps) {
  const listId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const initialFocus = useRef(0)
  const [open, setOpen] = useState(false)
  const disabled = options.length === 0
  const expanded = open && !disabled && !busy

  useEffect(() => {
    if (disabled || busy) setOpen(false)
    if (!expanded) return
    const frame = requestAnimationFrame(() => {
      optionButtons(listId).at(initialFocus.current)?.focus()
    })
    return () => { cancelAnimationFrame(frame) }
  }, [expanded, disabled, busy, listId])

  function close(restoreFocus = false) {
    if (restoreFocus) trigger.current?.focus()
    setOpen(false)
  }

  function show(index: number) {
    initialFocus.current = index
    setOpen(true)
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (expanded && (event.key === 'Escape' || event.key === 'Tab')) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
      }
      close(true)
      return
    }
    if (disabled || busy) return
    const forward = event.key === 'ArrowDown'
    const backward = event.key === 'ArrowUp'
    if (!expanded && (forward || backward)) {
      event.preventDefault()
      show(forward ? 0 : -1)
      return
    }
    if (!expanded || (!forward && !backward && event.key !== 'Home' && event.key !== 'End')) return
    event.preventDefault()
    const buttons = optionButtons(listId)
    if (buttons.length === 0) return
    const focused = buttons.findIndex(button => button === event.target)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? -1
      : focused === -1 ? (forward ? 0 : -1) : (focused + (forward ? 1 : -1)) % buttons.length
    buttons.at(next)?.focus()
  }

  function leave(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget
    if (!expanded || (next instanceof Node &&
      (event.currentTarget.contains(next) || document.getElementById(listId)?.contains(next)))) return
    close()
  }

  return (
    <div className={css.root} onKeyDown={navigate} onBlur={leave}>
      <Menu
        open={expanded}
        portal
        side="auto"
        dense
        singleSelect
        className={css.anchor}
        listId={listId}
        label={label}
        selectedId={selectedId}
        items={options.map(option => ({
          id: option.id,
          label: <span className={css.option}>
            {option.label}
            {option.detail !== undefined && <span className={css.detail}>{option.detail}</span>}
          </span>,
        }))}
        onClose={() => { close() }}
        onSelect={(id) => {
          close(true)
          if (id !== selectedId) onSelect(id)
        }}
        anchor={(
          <button ref={trigger} type="button" className={css.trigger} title={value ?? placeholder}
            disabled={disabled} aria-disabled={busy || undefined} aria-busy={busy || undefined}
            aria-haspopup="menu" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
            onClick={() => {
              if (busy) return
              if (expanded) close()
              else show(Math.max(0, options.findIndex(option => option.id === selectedId)))
            }}>
            <span className={css.caption}>{label}</span>
            <span className={css.value}>{value ?? placeholder}</span>
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
