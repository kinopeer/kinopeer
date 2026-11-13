import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Poster } from './Poster'

describe('Poster', () => {
  it('is a decorative frame without an action', () => {
    const { container } = render(<Poster />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(container.querySelector('.ks-poster-none')).not.toBeNull()
  })

  it('makes the empty frame a button named by its visible label, which does the action', async () => {
    const onClick = vi.fn()
    const { container } = render(<Poster className="torrent-poster" action={{ label: 'Match title', icon: 'search', onClick }} />)
    const button = screen.getByRole('button', { name: 'Match title' })
    expect(button).toHaveClass('ks-poster', 'torrent-poster')
    expect(button).toHaveTextContent('Match title')
    expect(button.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does nothing while its action is off', async () => {
    const onClick = vi.fn()
    render(<Poster action={{ label: 'Match title', icon: 'search', disabled: true, onClick }} />)
    const button = screen.getByRole('button', { name: 'Match title' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows the image, not a button, once there is one', () => {
    const { container } = render(<Poster src="/tmdb-img/w342/d.jpg" action={{ label: 'Match title', icon: 'search', onClick: vi.fn() }} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', '/tmdb-img/w342/d.jpg')
  })
})
