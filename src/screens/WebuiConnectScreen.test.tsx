import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as webui from '../api/qbittorrent/webui'
import { QbittorrentError } from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { WebuiConnectScreen } from './WebuiConnectScreen'

vi.mock('../api/qbittorrent/webui', () => ({ logIn: vi.fn() }))

const logIn = vi.mocked(webui.logIn)

beforeEach(() => {
  vi.stubGlobal('__WEBUI__', true)
  logIn.mockReset()
})

async function fillAndSubmit(username = 'admin', password = 'secret') {
  await userEvent.type(screen.getByRole('textbox', { name: 'Username' }), username)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('WebuiConnectScreen', () => {
  it("asks for qBittorrent's login in fields a password manager fills, and nothing about an address or Kinopeer's server", () => {
    render(<WebuiConnectScreen onRetry={() => {}} />, { wrapper: ToastProvider })

    expect(screen.getByRole('heading', { name: 'Sign in to qBittorrent' })).toBeInTheDocument()
    expect(screen.getByText('Kinopeer runs in qBittorrent’s Web UI: sign in with its username and password.')).toBeInTheDocument()
    const username = screen.getByRole('textbox', { name: 'Username' })
    expect(username).toHaveAttribute('autocomplete', 'username')
    expect(username).toBeRequired()
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    expect(password).toBeRequired()
    expect(password.closest('form')).toBe(username.closest('form'))
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /find/i })).not.toBeInTheDocument()
  })

  it('signs in and checks the session again, which brings the app', async () => {
    logIn.mockResolvedValue('ok')
    const onRetry = vi.fn()
    render(<WebuiConnectScreen onRetry={onRetry} />, { wrapper: ToastProvider })
    await fillAndSubmit('admin', 'secret')

    expect(logIn).toHaveBeenCalledWith('admin', 'secret')
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows a wrong login on the password field, and clears it as the login changes', async () => {
    logIn.mockResolvedValue('invalid')
    const onRetry = vi.fn()
    render(<WebuiConnectScreen onRetry={onRetry} />, { wrapper: ToastProvider })
    await fillAndSubmit()

    const password = screen.getByLabelText('Password')
    expect(await screen.findByText('Wrong username or password')).toBeInTheDocument()
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveAttribute('aria-invalid', 'true')
    expect(onRetry).not.toHaveBeenCalled()
    // The button works again for the next try.
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toHaveAttribute('aria-busy', 'true')

    await userEvent.type(password, 'x')
    expect(screen.queryByText('Wrong username or password')).not.toBeInTheDocument()
  })

  it('explains a ban', async () => {
    logIn.mockResolvedValue('banned')
    render(<WebuiConnectScreen onRetry={() => {}} />, { wrapper: ToastProvider })
    await fillAndSubmit()
    expect(await screen.findByText('Too many failed attempts. qBittorrent has blocked this address for a while.')).toBeInTheDocument()
  })

  it('says qBittorrent didn’t answer when nothing did, and that it refused otherwise', async () => {
    logIn.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new QbittorrentError('qBittorrent responded 500', 500))
    render(<WebuiConnectScreen onRetry={() => {}} />, { wrapper: ToastProvider })
    await fillAndSubmit()
    expect(await screen.findByText('qBittorrent isn’t answering')).toBeInTheDocument()
    expect(screen.getByText('Check that qBittorrent is running and its Web UI is on.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('qBittorrent didn’t sign you in. Try again.')).toBeInTheDocument()
    expect(screen.queryByText('qBittorrent isn’t answering')).not.toBeInTheDocument()
  })

  it('sends one login at a time', async () => {
    let answer: (result: webui.LogInResult) => void = () => {}
    logIn.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    render(<WebuiConnectScreen onRetry={() => {}} />, { wrapper: ToastProvider })
    await fillAndSubmit()
    await userEvent.type(screen.getByLabelText('Password'), '{Enter}')
    expect(logIn).toHaveBeenCalledOnce()
    answer('invalid')
    await waitFor(() => expect(screen.getByText('Wrong username or password')).toBeInTheDocument())
  })

  it('shows who didn’t answer the session check, or a qBittorrent too old, in place of the form', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<WebuiConnectScreen unreachable="qbittorrent" onRetry={onRetry} />, { wrapper: ToastProvider })
    expect(screen.getByRole('heading', { name: 'qBittorrent isn’t answering' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()

    rerender(<WebuiConnectScreen unsupported="5.1.4" onRetry={onRetry} />)
    expect(screen.getByRole('heading', { name: 'qBittorrent 5.1.4 is too old' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
