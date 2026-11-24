/** A controlled single-choice menu for toolbar controls. */
import { useState } from 'react'
import { IconChevronDownOutlineRegular } from './icons/index.tsx'
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

/**
 * Show a controlled choice in a keyboard-accessible popup.
 * @param props - localized trigger copy, current choice, options, and selection handler.
 * @returns A toolbar trigger and its viewport-constrained menu.
 */
export function ChoiceMenu({ label, value, placeholder, options, selectedId, busy = false, onSelect }: ChoiceMenuProps) {
  const [openAt, setOpenAt] = useState<'first' | 'last' | null>(null)
  const disabled = options.length === 0 || busy
  const expanded = openAt !== null && !disabled
  return (
    <span className={css.root}>
      <Menu
        open={expanded}
        portal
        side="top"
        dense
        autoFocus={openAt === 'last' ? 'last' : true}
        selection="radio"
        label={label}
        className={css.anchor}
        selectedId={selectedId}
        items={options.map(option => ({
          id: option.id,
          label: <span className={css.option}>
            {option.label}
            {option.detail !== undefined && <span className={css.detail}>{option.detail}</span>}
          </span>,
        }))}
        onClose={() => { setOpenAt(null) }}
        onSelect={(id) => {
          setOpenAt(null)
          if (id !== selectedId) onSelect(id)
        }}
        anchor={(
          <button type="button" className={css.trigger} title={value ?? placeholder}
            aria-label={label + ' ' + (value ?? placeholder)}
            disabled={disabled} aria-busy={busy || undefined} aria-haspopup="menu" aria-expanded={expanded}
            onKeyDown={(event) => {
              if (expanded || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
              event.preventDefault()
              setOpenAt(event.key === 'ArrowUp' ? 'last' : 'first')
            }}
            onClick={() => { setOpenAt(value => value === null ? 'first' : null) }}>
            <span className={css.caption}>{label}</span>
            <span className={css.value}>{value ?? placeholder}</span>
            <IconChevronDownOutlineRegular className={css.chevron} />
          </button>
        )}
      />
    </span>
  )
}
