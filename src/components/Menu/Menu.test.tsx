import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { Menu, MenuDivider, MenuGroup, MenuItem, MenuItemRadio, MenuLink } from './Menu'

// Placement, the click outside, the anchor's toggle and `follow` are Popover's, tested there.
function Harness({ onPick = vi.fn() }: { onPick?: (item: string) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <MemoryRouter>
      <button type="button" onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}>
        Open
      </button>
      {anchor && (
        <Menu anchor={anchor} label="Actions" onClose={() => setAnchor(null)} footer={<p>Footer</p>}>
          <MenuItem icon="pause" onClick={() => onPick('pause')}>
            Pause
          </MenuItem>
          <MenuItem disabled>Disabled</MenuItem>
          <MenuLink to="/title/movie/1">Movie page</MenuLink>
          <MenuDivider />
          <MenuGroup label="Is it right?">
            <MenuItemRadio checked={false} label="Yes" hint="The guess" />
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
    expect(screen.getByRole('menuitemradio', { name: 'Yes' })).toHaveAttribute('aria-checked', 'false')
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

  it('focuses the checked option when it opens', async () => {
    function Options() {
      const [anchor, setAnchor] = useState<HTMLElement | null>(null)
      return (
        <>
          <button type="button" onClick={(event) => setAnchor(event.currentTarget)}>
            Sort
          </button>
          {anchor && (
            <Menu anchor={anchor} label="Sort" onClose={() => setAnchor(null)}>
              <MenuItemRadio checked={false} label="Name" />
              <MenuItemRadio checked label="Size" />
            </Menu>
          )}
        </>
      )
    }
    render(<Options />)
    await userEvent.click(screen.getByRole('button', { name: 'Sort' }))
    expect(screen.getByRole('menuitemradio', { name: 'Size' })).toHaveFocus()
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
