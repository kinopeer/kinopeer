import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

afterEach(() => {
  localStorage.clear()
})

describe('App', () => {
  it('renders the product name', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'kinoseed' })).toBeInTheDocument()
  })

  it('switches the theme on the root element', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('switches the language and remembers it', async () => {
    render(<App />)
    expect(screen.getByText('Movies and TV series for qBittorrent.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Русский' }))
    expect(screen.getByText('Фильмы и сериалы для qBittorrent.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Светлая' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('ru')
    expect(localStorage.getItem('kinoseed.lang')).toBe('ru')
  })
})
