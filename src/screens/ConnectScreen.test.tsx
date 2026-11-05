import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SettingsError } from '../api/settings'
import { ConnectScreen } from './ConnectScreen'
import { saying } from '../test/render'

function setup(onSignIn = vi.fn().mockResolvedValue(undefined), props: { unreachable?: boolean } = {}) {
  const onRetry = vi.fn()
  render(<ConnectScreen onSignIn={onSignIn} onRetry={onRetry} {...props} />)
  return { onSignIn, onRetry }
}

async function fillAndSubmit(username = 'admin', password = 'secret') {
  await userEvent.type(screen.getByLabelText('Username'), username)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
}

describe('ConnectScreen', () => {
  it('signs in with the entered credentials', async () => {
    const { onSignIn } = setup()
    await fillAndSubmit()
    expect(onSignIn).toHaveBeenCalledWith('admin', 'secret')
  })

  it('does not submit empty fields', async () => {
    const { onSignIn } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onSignIn).not.toHaveBeenCalled()
  })

  it('shows wrong credentials on the password field', async () => {
    setup(vi.fn().mockRejectedValue(new SettingsError(422, 'invalid-credentials')))
    await fillAndSubmit()

    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAccessibleDescription('Wrong username or password')
    expect(screen.getByRole('button', { name: 'Connect' })).not.toHaveAttribute('aria-busy')

    await userEvent.type(password, 'x')
    expect(password).not.toHaveAttribute('aria-invalid')
  })

  it('explains an IP ban', async () => {
    setup(vi.fn().mockRejectedValue(new SettingsError(429, 'banned')))
    await fillAndSubmit()
    expect(screen.getByRole('alert', { name: saying(/qBittorrent has blocked this address/) })).toBeInTheDocument()
  })

  it('reports an unreachable server and offers a retry', async () => {
    const { onRetry } = setup(undefined, { unreachable: true })
    expect(screen.getByRole('alert', { name: saying('qBittorrent is unreachable') })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('treats network errors during sign-in as unreachable', async () => {
    setup(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await fillAndSubmit()
    expect(screen.getByRole('alert', { name: saying('qBittorrent is unreachable') })).toBeInTheDocument()
  })

  it('switches the theme and the language before signing in', async () => {
    setup()
    const theme = within(screen.getByRole('group', { name: 'Theme' }))
    await userEvent.click(theme.getByRole('button', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(theme.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')
    expect(theme.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(within(screen.getByRole('group', { name: 'Language' })).getByRole('button', { name: 'Русский' }))
    expect(screen.getByRole('heading', { name: 'Подключите qBittorrent', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Русский' })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('kinopeer.language')).toBe('ru')
    expect(screen.getByRole('button', { name: 'Светлая' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps following the browser when the language already shown is tapped', async () => {
    setup()
    const language = within(screen.getByRole('group', { name: 'Language' }))
    expect(language.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(language.getByRole('button', { name: 'English' }))
    expect(localStorage.getItem('kinopeer.language')).toBeNull()
  })
})
