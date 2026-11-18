import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '../../test/render'
import { Button, ButtonLink } from './Button'

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

describe('ButtonLink', () => {
  it('is a link that looks like a button of its variant, size and width, with its icon', () => {
    renderWithRouter(
      <ButtonLink to="/torrent/abc" variant="secondary" size="lg" block icon="info">
        Open details
      </ButtonLink>,
    )
    const link = screen.getByRole('link', { name: 'Open details' })
    expect(link).toHaveAttribute('href', '/torrent/abc')
    expect(link).toHaveClass('ks-btn', 'ks-btn-secondary', 'ks-btn-lg', 'ks-btn-block')
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(link.querySelector('svg')).toHaveAttribute('width', '20')
  })

  it('takes the small icon in a small one', () => {
    renderWithRouter(
      <ButtonLink to="/" size="sm" icon="info">
        Home
      </ButtonLink>,
    )
    expect(screen.getByRole('link', { name: 'Home' }).querySelector('svg')).toHaveAttribute('width', '16')
  })

  it('defaults to a primary md one', () => {
    renderWithRouter(<ButtonLink to="/">Home</ButtonLink>)
    const link = screen.getByRole('link', { name: 'Home' })
    expect(link).toHaveClass('ks-btn', 'ks-btn-primary')
    expect(link).not.toHaveClass('ks-btn-md')
  })
})
