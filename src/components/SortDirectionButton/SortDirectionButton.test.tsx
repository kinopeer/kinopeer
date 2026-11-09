import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '../../i18n'
import { SortDirectionButton } from './SortDirectionButton'

describe('SortDirectionButton', () => {
  it('is named by the direction the list is in, its icon turned for ascending, and asks for the other on a press', async () => {
    const onReverse = vi.fn()
    const { rerender } = render(<SortDirectionButton descending onReverse={onReverse} />)
    const descending = screen.getByRole('button', { name: 'Descending' })
    expect(descending).not.toHaveClass('is-ascending')
    await userEvent.click(descending)
    expect(onReverse).toHaveBeenCalledTimes(1)

    rerender(<SortDirectionButton descending={false} onReverse={onReverse} size="sm" />)
    const ascending = screen.getByRole('button', { name: 'Ascending' })
    expect(ascending).toHaveClass('is-ascending', 'ks-icon-btn-sm')
  })
})
