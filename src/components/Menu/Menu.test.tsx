import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { Menu, type MenuProps, MenuDivider, MenuGroup, MenuItem, MenuItemRadio, MenuLink } from './Menu'

function Harness({ onPick = vi.fn(), align }: { onPick?: (item: string) => void; align?: MenuProps['align'] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <MemoryRouter>
      <button type="button" onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}>
        Open
      </button>
      <button type="button">Elsewhere</button>
      {anchor && (
        <Menu anchor={anchor} label="Actions" align={align} onClose={() => setAnchor(null)} footer={<p>Footer</p>}>
          <MenuItem icon="pause" onClick={() => onPick('pause')}>
            Pause
          </MenuItem>
          <MenuItem disabled>Disabled</MenuItem>
          <MenuLink to="/title/movie/1">Movie page</MenuLink>
          <MenuDivider />
          <MenuGroup label="Is it right?">
            <MenuItemRadio checked label="Yes" hint="The guess" />
          </MenuGroup>
          <MenuItem danger>Delete</MenuItem>
        </Menu>
      )}
    </MemoryRouter>
  )
}

describe('Menu', () => {
  it('opens with focus on the first item and moves with the arrow keys, skipping disabled items', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('menu', { name: 'Actions' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Pause' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Movie page' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: 'Yes' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Yes' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Pause' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    expect(screen.getByRole('group', { name: 'Is it right?' })).toBeInTheDocument()
    expect(screen.getByText('Footer')).toBeInTheDocument()
  })

  it('closes on Escape and Tab, with focus back on the anchor', async () => {
    render(<Harness />)
    const open = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(open)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(open).toHaveFocus()

    await userEvent.click(open)
    await userEvent.tab()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(open).toHaveFocus()
  })

  it('closes on a click outside, and the anchor toggles it', async () => {
    render(<Harness />)
    const open = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(open)
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await userEvent.click(open)
    await userEvent.click(open)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('lines up with the anchor’s right edge, or its left one when asked', async () => {
    vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 136,
      left: 300,
      right: 400,
    } as DOMRect)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(220)
    const { unmount } = render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('menu').parentElement).toHaveStyle({ left: '180px' })
    unmount()

    render(<Harness align="start" />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('menu').parentElement).toHaveStyle({ left: '300px' })
    vi.restoreAllMocks()
  })

  it('runs an item’s action', async () => {
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pause' }))
    expect(onPick).toHaveBeenCalledWith('pause')
    expect(screen.getByRole('menuitem', { name: 'Movie page' })).toHaveAttribute('href', '/title/movie/1')
  })
})
