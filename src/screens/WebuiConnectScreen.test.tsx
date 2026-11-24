import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as webui from '../api/qbittorrent/webui'
import { QbittorrentError, unreachable } from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { namesTheFailedLink } from '../test/failedLinks'
import { saying } from '../test/render'
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
    expect(username).toHaveAttribute('spellcheck', 'false')
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    expect(password).toBeRequired()
    expect(password.closest('form')).toBe(username.closest('form'))
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /find/i })).not.toBeInTheDocument()
    // No error before a login is sent.
    expect(username).not.toHaveAttribute('aria-invalid')
    expect(password).not.toHaveAttribute('aria-invalid')
    expect(password).not.toHaveAccessibleDescription()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('signs in and checks the session again, which brings the app', async () => {
    logIn.mockResolvedValue('ok')
    const onRetry = vi.fn()
    render(<WebuiConnectScreen onRetry={onRetry} />, { wrapper: ToastProvider })
    await fillAndSubmit('admin', 'secret')

    expect(logIn).toHaveBeenCalledWith('admin', 'secret')
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('keeps the page where it is as the form is sent, rather than letting the browser submit it', () => {
    logIn.mockReturnValue(new Promise(() => {}))
    render(<WebuiConnectScreen onRetry={() => {}} />, { wrapper: ToastProvider })
    // fireEvent answers false when the handler prevented the browser's own submit.
    expect(fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!)).toBe(false)
  })

  it('shows a wrong login on the password field, and clears it as the login changes', async () => {
    logIn.mockResolvedValue('invalid')
    const onRetry = vi.fn()
    render(<WebuiConnectScreen onRetry={onRetry} />, { wrapper: ToastProvider })
    await fillAndSubmit()

    const password = screen.getByLabelText('Password')
    await waitFor(() => expect(password).toHaveAccessibleDescription('Wrong username or password'))
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('textbox', { name: 'Username' })).toHaveAttribute('aria-invalid', 'true')
    expect(onRetry).not.toHaveBeenCalled()
    // The button works again for the next try.
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toHaveAttribute('aria-busy', 'true')

    await userEvent.type(password, 'x')
    expect(password).not.toHaveAccessibleDescription()
    expect(password).not.toHaveAttribute('aria-invalid')

    // The username clears it too.
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(password).toHaveAccessibleDescription('Wrong username or password'))
    await userEvent.type(screen.getByRole('textbox', { name: 'Username' }), 'x')
    expect(password).not.toHaveAccessibleDescription()
  })

  it('explains a ban', async () => {
    logIn.mockResolvedValue('banned')
    render(<WebuiConnectScreen onRetry={() => {}} />, { wrapper: ToastProvider })
    await fillAndSubmit()
    const ban = saying('Too many failed attempts. qBittorrent has blocked this address for a while.')
    expect(await screen.findByRole('alert', { name: ban })).toBeInTheDocument()
    // Typing doesn't lift a ban: only a login does.
    await userEvent.type(screen.getByLabelText('Password'), 'x')
    expect(screen.getByRole('alert', { name: ban })).toBeInTheDocument()
  })

  it('takes the last failure back while the next login is on its way', async () => {
    logIn.mockResolvedValueOnce('banned').mockReturnValueOnce(new Promise(() => {}))
    render(<WebuiConnectScreen onRetry={() => {}} />, { wrapper: ToastProvider })
    await fillAndSubmit()
    expect(await screen.findByRole('alert', { name: saying(/Too many failed attempts/) })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.queryByRole('alert', { name: saying(/Too many failed attempts/) })).not.toBeInTheDocument()
  })

  it('says qBittorrent didn’t answer when nothing did or the login’s time ran out, and that it refused otherwise', async () => {
    logIn
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      // The login's time limit aborts it.
      .mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))
      .mockRejectedValueOnce(new QbittorrentError('qBittorrent responded 500', 500))
    render(<WebuiConnectScreen onRetry={() => {}} />, { wrapper: ToastProvider })
    await fillAndSubmit()
    const noAnswer = await screen.findByRole('alert', { name: saying('qBittorrent isn’t answering') })
    expect(noAnswer).toHaveTextContent('Check that qBittorrent is running and its Web UI is on.')

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(logIn).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('alert', { name: saying('qBittorrent isn’t answering') })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert', { name: saying('qBittorrent didn’t sign you in. Try again.') })).toBeInTheDocument()
    expect(screen.queryByRole('alert', { name: saying('qBittorrent isn’t answering') })).not.toBeInTheDocument()
  })

  it('sends one login at a time', async () => {
    let answer: (result: webui.LogInResult) => void = () => {}
    logIn.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    render(<WebuiConnectScreen onRetry={() => {}} />, { wrapper: ToastProvider })
    await fillAndSubmit()
    await userEvent.type(screen.getByLabelText('Password'), '{Enter}')
    expect(logIn).toHaveBeenCalledOnce()
    answer('invalid')
    await waitFor(() => expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Wrong username or password'))
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

namesTheFailedLink('The WebUI build’s connect screen, when the session check fails', {
  service: 'qbittorrent',
  builds: ['webui'],
  // As the session reads the check's failure (useQbitSession).
  show: async (error) => {
    render(<WebuiConnectScreen unreachable={unreachable(error)} onRetry={() => {}} />, { wrapper: ToastProvider })
    return screen.getByRole('main')
  },
  says: { kinopeer: 'Kinopeer isn’t answering', service: 'qBittorrent isn’t answering' },
})
