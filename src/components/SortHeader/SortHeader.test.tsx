import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SortHeader } from './SortHeader'

type Key = 'name' | 'size'

function renderHeader(order: { key: Key; descending: boolean }, label?: string) {
  const onSort = vi.fn<(sort: Key) => void>()
  render(
    <div role="table">
      <div role="row">
        <SortHeader sort="size" order={order} onSort={onSort} label={label} className="wide">
          Size
        </SortHeader>
      </div>
    </div>,
  )
  const header = screen.getByRole('columnheader')
  return { onSort, header, arrow: () => header.querySelector('svg') }
}

describe('SortHeader', () => {
  it('is a button named by the column, plain while the table is in another order', async () => {
    const { onSort, header, arrow } = renderHeader({ key: 'name', descending: true })
    expect(header).toHaveClass('wide')
    expect(header).not.toHaveAttribute('aria-sort')
    expect(arrow()).toBeNull()
    const button = screen.getByRole('button', { name: 'Size' })
    expect(button).not.toHaveClass('is-on')
    await userEvent.click(button)
    expect(onSort).toHaveBeenCalledExactlyOnceWith('size')
  })

  it('says the direction while the table is in its order, with an arrow pointing that way', () => {
    const descending = renderHeader({ key: 'size', descending: true })
    expect(descending.header).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('button', { name: 'Size' })).toHaveClass('is-on')
    const down = descending.arrow()!.innerHTML
    document.body.innerHTML = ''

    const ascending = renderHeader({ key: 'size', descending: false })
    expect(ascending.header).toHaveAttribute('aria-sort', 'ascending')
    expect(ascending.arrow()).not.toBeNull()
    expect(ascending.arrow()!.innerHTML).not.toBe(down)
  })

  it('adds a hidden label after the visible name', () => {
    const { header } = renderHeader({ key: 'name', descending: false }, 'by size')
    expect(screen.getByRole('button', { name: 'Size by size' })).toBeInTheDocument()
    expect(header.querySelector('.sr-only')).toHaveTextContent('by size')
  })
})
