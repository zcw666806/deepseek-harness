// @vitest-environment jsdom
/** Portal menus delegate minimum width and viewport limits to CSS. */
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { Menu } from '../src/Menu.tsx'
import { ChoiceMenu } from '../src/ChoiceMenu.tsx'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Menu anchor minimum width', () => {
  it('registers only the external trigger as its anchor', () => {
    function Fixture() {
      const trigger = useRef<HTMLButtonElement>(null)
      return <><button ref={trigger}>Tools</button>
        <Menu open portal anchor={null} anchorRef={trigger}
          items={[{ id: 'one', label: 'One' }]} onClose={vi.fn()} /></>
    }
    const view = render(<Fixture />)
    const trigger = view.getByRole('button', { name: 'Tools' })
    const name = view.getByRole('menu').style.positionAnchor
    expect(name).not.toBe('')
    expect([...document.querySelectorAll<HTMLElement>('[style]')]
      .filter(node => node.style.anchorName === name)).toEqual([trigger])
  })

  it('enables anchor-width matching and clears it when the option is removed', () => {
    const props = { open: true, portal: true, align: 'end' as const, anchor: <button>Tools</button>, onClose: vi.fn() }
    const view = render(<Menu {...props} minWidthFromAnchor items={[{ id: 'one', label: 'One' }]} />)
    const menu = view.getByRole('menu')
    expect(menu.hasAttribute('data-match-anchor-width')).toBe(true)
    expect(menu.style.minWidth).toBe('')
    expect(menu.style.positionAnchor).not.toBe('')
    view.rerender(<Menu {...props} items={[{ id: 'one', label: 'One' }]} />)
    expect(view.getByRole('menu').hasAttribute('data-match-anchor-width')).toBe(false)
  })

  it('keeps matching declarative when the visual viewport is narrower than its anchor', () => {
    const readRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), {
      width: 200, height: 400, offsetLeft: 40, offsetTop: 60,
    }))
    const view = render(<Menu open portal minWidthFromAnchor align="end" anchor={<button style={{ width: 280 }}>Tools</button>}
      items={[{ id: 'one', label: 'One' }]} onClose={vi.fn()} />)
    const menu = view.getByRole('menu')
    expect(menu.hasAttribute('data-match-anchor-width')).toBe(true)
    expect(menu.style.minWidth).toBe('')
    expect(menu.style.left).toBe('')
    expect(readRect).not.toHaveBeenCalled()
  })
})

it('passes the visible-row limit to CSS and clears it when the option is removed', () => {
  const props = { open: true, anchor: null, items: [{ id: 'one', label: 'One' }], onClose: vi.fn() }
  const view = render(<Menu {...props} maxVisibleRows={6} />)
  const menu = view.getByRole('menu')
  expect(menu.style.getPropertyValue('--dsh-menu-visible-rows')).toBe('6')
  view.rerender(<Menu {...props} maxVisibleRows={3} />)
  expect(menu.style.getPropertyValue('--dsh-menu-visible-rows')).toBe('3')
  view.rerender(<Menu {...props} />)
  expect(menu.style.getPropertyValue('--dsh-menu-visible-rows')).toBe('')
})

it('opens a labelled single-choice menu with arrow keys and restores trigger focus on selection', async () => {
  const onSelect = vi.fn()
  const view = render(<ChoiceMenu label="Image model" value="First" placeholder="Choose a model"
    options={[{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }]}
    selectedId="first" onSelect={onSelect} />)
  const trigger = view.getByRole('button', { name: 'Image model First' })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  const menu = view.getByRole('menu', { name: 'Image model' })
  const first = within(menu).getByRole('menuitemradio', { name: 'First', checked: true })
  const second = within(menu).getByRole('menuitemradio', { name: 'Second', checked: false })
  expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(second)
  fireEvent.keyDown(second, { key: 'Tab' })
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('second')
  await waitFor(() => { expect(document.activeElement).toBe(trigger) })
})
