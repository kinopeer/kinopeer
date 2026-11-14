import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { Menu, MenuDivider, MenuItem, MenuItemRadio, MenuLink } from './Menu'
import { ROUTER_OPTIONS } from '../../lib/routerOptions'

// Placement, the click outside, the anchor's toggle and `follow` are Popover's, tested there.
function Harness({ onPick = vi.fn() }: { onPick?: (item: string) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <MemoryRouter {...ROUTER_OPTIONS}>
      <button type="button" onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}>
        Open
      </button>
      {anchor && (
        <Menu anchor={anchor} label="Actions" onClose={() => setAnchor(null)} footer={<p>Footer</p>}>
          <MenuItem icon="pause" onClick={() => onPick('pause')}>
            Pause
          </MenuItem>
          <MenuItem disabled hint="Not now">
            Disabled
          </MenuItem>
          <MenuLink to="/title/movie/1">Movie page</MenuLink>
          <MenuDivider />
          <MenuItemRadio checked={false} label="Yes" hint="The guess" />
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
    expect(screen.getByText('Footer')).toBeInTheDocument()
  })

  it('keeps the arrow keys working after a click on a disabled item', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Disabled' }))
    expect(screen.getByRole('menu', { name: 'Actions' })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Pause' })).toHaveFocus()
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

  it('shows an item’s hint under its label as its description', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('menuitem', { name: 'Disabled' })).toHaveAccessibleDescription('Not now')
  })

  it('marks a highlighted item for the accent and a dangerous one for red, each alone', () => {
    render(
      <>
        <MenuItem highlight>Match title</MenuItem>
        <MenuItem danger>Delete</MenuItem>
        <MenuItem>Move files</MenuItem>
      </>,
    )
    const highlighted = screen.getByRole('menuitem', { name: 'Match title' })
    const dangerous = screen.getByRole('menuitem', { name: 'Delete' })
    const plain = screen.getByRole('menuitem', { name: 'Move files' })
    // The classes are what put an item in the accent or in red; no role or attribute says it.
    expect(highlighted).toHaveClass('is-highlight')
    expect(highlighted).not.toHaveClass('is-danger')
    expect(dangerous).toHaveClass('is-danger')
    expect(dangerous).not.toHaveClass('is-highlight')
    expect(plain).not.toHaveClass('is-highlight')
    expect(plain).not.toHaveClass('is-danger')
  })
})
