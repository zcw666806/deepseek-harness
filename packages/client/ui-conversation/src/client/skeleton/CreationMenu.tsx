/** Selects a project workflow in the composer. */
import { useState } from 'react'
import type { StudioKind, StudioNavigation } from '@deepseek-ai/dsh-client-ui-layout/client'
import { IconChevronDownOutlineRegular, IconListPenOutlineRegular, IconPlayOutlineRegular, IconSparkleRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './InputBar.module.css'

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
  const expanded = open && !disabled
  const items = [
    ...navigation.entries.map(({ kind, label }) => ({
      id: kind,
      label,
      icon: kind === 'comic' ? <IconListPenOutlineRegular /> : <IconPlayOutlineRegular />,
    })),
    ...(selected === null ? [] : [
      { id: 'regular-chat', label: chatLabel },
      { id: 'existing-projects', label: navigation.existingLabel },
    ]),
  ]
  const label = navigation.entries.find(entry => entry.kind === selected)?.label ?? navigation.label

  return (
    <span className={css.creationMenu}>
      <Menu
        open={expanded}
        side="top"
        portal
        autoFocus
        items={items}
        selectedId={selected ?? undefined}
        onClose={() => { setOpen(false) }}
        onSelect={(id) => {
          setOpen(false)
          if (id === 'regular-chat') select(null)
          else if (id === 'existing-projects' && selected !== null) navigation.openExisting(selected)
          else {
            const entry = navigation.entries.find(({ kind }) => kind === id)
            if (entry !== undefined) select(entry.kind)
          }
        }}
        anchor={(
          <button type="button" className={css.creationTrigger} aria-label={label}
            data-active={selected === null ? undefined : ''}
            aria-haspopup="menu" aria-expanded={expanded} disabled={disabled}
            onClick={() => { setOpen(value => !value) }}>
            <IconSparkleRegular size={14} />{label}<IconChevronDownOutlineRegular />
          </button>
        )}
      />
    </span>
  )
}
