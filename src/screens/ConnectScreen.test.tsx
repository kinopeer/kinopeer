import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SettingsError } from '../api/settings'
import { ConnectScreen } from './ConnectScreen'

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
    expect(screen.getByRole('alert')).toHaveTextContent('qBittorrent has blocked this address')
  })

  it('reports an unreachable server and offers a retry', async () => {
    const { onRetry } = setup(undefined, { unreachable: true })
    expect(screen.getByRole('alert')).toHaveTextContent('qBittorrent is unreachable')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('treats network errors during sign-in as unreachable', async () => {
    setup(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await fillAndSubmit()
    expect(screen.getByRole('alert')).toHaveTextContent('qBittorrent is unreachable')
  })
})
