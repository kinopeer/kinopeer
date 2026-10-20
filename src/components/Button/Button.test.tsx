import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('defaults to a primary md button that does not submit forms', () => {
    render(<Button>Download</Button>)
    const button = screen.getByRole('button', { name: 'Download' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('ks-btn', 'ks-btn-primary')
    expect(button).not.toHaveClass('ks-btn-md')
  })

  it('applies variant, size and block classes', () => {
    render(
      <Button variant="secondary" size="lg" block>
        Cancel
      </Button>,
    )
    expect(screen.getByRole('button')).toHaveClass('ks-btn-secondary', 'ks-btn-lg', 'ks-btn-block')
  })

  it('marks itself busy while loading', () => {
    render(<Button loading>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveClass('is-loading')
  })

  it('renders a decorative leading icon', () => {
    render(<Button icon="download">Download</Button>)
    expect(screen.getByRole('button', { name: 'Download' }).querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })

  it('calls onClick unless disabled', async () => {
    const onClick = vi.fn()
    const { rerender } = render(<Button onClick={onClick}>Go</Button>)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)

    rerender(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
