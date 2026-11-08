import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Unreachable } from '../api/qbittorrent'
import { SettingsError } from '../api/settings'
import * as proxySignIn from '../pwa/proxySignIn'
import { ConnectScreen } from './ConnectScreen'
import { controlledByServiceWorker, saying } from '../test/render'

vi.mock('../pwa/proxySignIn', async (importOriginal) => ({
  ...(await importOriginal<typeof proxySignIn>()),
  loadPastTheShell: vi.fn(),
}))

function setup(onSignIn = vi.fn().mockResolvedValue(undefined), props: { unreachable?: Unreachable } = {}) {
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
    // A refused login is the server answering: nothing says it's unreachable.
    expect(screen.queryByRole('alert', { name: saying(/unreachable|answering/) })).not.toBeInTheDocument()

    await userEvent.type(password, 'x')
    expect(password).not.toHaveAttribute('aria-invalid')
  })

  it('explains an IP ban', async () => {
    setup(vi.fn().mockRejectedValue(new SettingsError(429, 'banned')))
    await fillAndSubmit()
    expect(screen.getByRole('alert', { name: saying(/qBittorrent has blocked this address/) })).toBeInTheDocument()
    expect(screen.queryByRole('alert', { name: saying(/unreachable|answering/) })).not.toBeInTheDocument()
  })

  it('shows who didn’t answer the session check in place of the form, with Retry', async () => {
    const { onRetry } = setup(undefined, { unreachable: 'qbittorrent' })
    expect(screen.getByRole('heading', { name: 'qBittorrent is unreachable' })).toBeInTheDocument()
    expect(screen.getByText('Check that qBittorrent is running and its Web UI is on.')).toBeInTheDocument()
    // No login form until there's someone to sign in to; the theme and language stay.
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('says Kinopeer, not qBittorrent, didn’t answer the session check, and offers Open again past the shell beside Retry', async () => {
    controlledByServiceWorker()
    const { onRetry } = setup(undefined, { unreachable: 'unreached' })
    expect(screen.getByRole('heading', { name: 'Kinopeer isn’t answering' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'If you’re sure the server running Kinopeer is on and reachable on your network, your browser may need to confirm its certificate again: open Kinopeer again.',
      ),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open again' }))
    expect(proxySignIn.loadPastTheShell).toHaveBeenCalledOnce()
    expect(onRetry).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('offers only Retry when something answered for Kinopeer’s server, as Umbrel does for a stopped app', () => {
    controlledByServiceWorker()
    setup(undefined, { unreachable: 'kinopeer' })
    expect(screen.getByRole('heading', { name: 'Kinopeer isn’t answering' })).toBeInTheDocument()
    // Its certificate and sign-in are fine, so nothing says to open it again.
    expect(screen.getByText('Check that this device is online and Kinopeer is running on your server.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open again' })).not.toBeInTheDocument()
  })

  it('takes a network error during sign-in for Kinopeer unreached, over the form, with Open again', async () => {
    controlledByServiceWorker()
    setup(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await fillAndSubmit()
    const alert = screen.getByRole('alert', { name: saying('Kinopeer isn’t answering') })
    expect(alert).toHaveTextContent('If you’re sure the server running Kinopeer is on and reachable on your network')
    // What was typed stays.
    expect(screen.getByLabelText('Username')).toHaveValue('admin')
    await userEvent.click(within(alert).getByRole('button', { name: 'Open again' }))
    expect(proxySignIn.loadPastTheShell).toHaveBeenCalledOnce()
  })

  it('takes a sign-in failure without the server’s word for something answering for Kinopeer, without Open again', async () => {
    controlledByServiceWorker()
    setup(vi.fn().mockRejectedValue(new SettingsError(502)))
    await fillAndSubmit()
    const alert = screen.getByRole('alert', { name: saying('Kinopeer isn’t answering') })
    expect(within(alert).queryByRole('button', { name: 'Open again' })).not.toBeInTheDocument()
  })

  it('takes any answer of the server’s own, qBittorrent not set up included, for the server answering', async () => {
    setup(vi.fn().mockRejectedValue(new SettingsError(503, 'not-configured')))
    await fillAndSubmit()
    expect(screen.getByRole('alert', { name: saying('qBittorrent is unreachable') })).toBeInTheDocument()
  })

  it('takes the server’s word that qBittorrent did not answer the sign-in', async () => {
    setup(vi.fn().mockRejectedValue(new SettingsError(502, 'unreachable')))
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
