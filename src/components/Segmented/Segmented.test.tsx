import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Segmented } from './Segmented'

const OPTIONS = [
  { value: 'list', label: 'List', icon: 'list' },
  { value: 'grid', label: 'Grid', icon: 'grid' },
] as const

describe('Segmented', () => {
  it('is a radio group that reports the picked option', async () => {
    const onChange = vi.fn()
    render(<Segmented label="View" options={[...OPTIONS]} value="list" onChange={onChange} />)
    const group = screen.getByRole('radiogroup', { name: 'View' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'List', checked: true })).toHaveTextContent('List')
    await userEvent.click(screen.getByRole('radio', { name: 'Grid', checked: false }))
    expect(onChange).toHaveBeenCalledWith('grid')
  })

  it('shows icons next to the labels', () => {
    const { container } = render(<Segmented label="View" options={[...OPTIONS]} value="list" onChange={vi.fn()} />)
    expect(container.querySelectorAll('svg')).toHaveLength(2)
    expect(container.querySelector('.ks-seg')).not.toHaveClass('ks-seg-icons')
  })

  it('names icon-only buttons by their labels', () => {
    const { container } = render(
      <Segmented label="View" options={[...OPTIONS]} value="grid" onChange={vi.fn()} iconsOnly />,
    )
    expect(container.querySelector('.ks-seg')).toHaveClass('ks-seg-icons')
    const grid = screen.getByRole('radio', { name: 'Grid', checked: true })
    expect(grid).toHaveTextContent('')
    expect(grid.querySelector('svg')).not.toBeNull()
  })
})
