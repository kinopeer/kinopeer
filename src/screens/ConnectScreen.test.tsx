import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as settings from '../api/settings'
import { SettingsError, type ServerSettings } from '../api/settings'
import * as proxySignIn from '../pwa/proxySignIn'
import { ToastProvider } from '../components/Toast'
import en from '../i18n/locales/en.json'
import { russianUnreachable } from '../test/languages'
import { ConnectScreen, type ConnectScreenProps } from './ConnectScreen'
import { controlledByServiceWorker, saying } from '../test/render'

vi.mock('../pwa/proxySignIn', async (importOriginal) => ({
  ...(await importOriginal<typeof proxySignIn>()),
  loadPastTheShell: vi.fn(),
}))
vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof settings>()),
  getServerSettings: vi.fn(),
}))

/** The server's settings with qBittorrent's address from `address` and Kinopeer's own login as given. */
function serverSettings(address: ServerSettings['qbittorrent']['address'], auth: ServerSettings['auth'] = { enabled: true, source: 'saved' }): ServerSettings {
  return {
    tmdb: { configured: true, source: 'saved', fallback: null },
    prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
    qbittorrent: { configured: false, source: null, address },
    downloads: null,
    auth,
  }
}

beforeEach(() => {
  // The environment's address by default, as on Umbrel: nothing to change here.
  vi.mocked(settings.getServerSettings).mockResolvedValue(serverSettings({ source: 'env' }))
})

type StateProps = Partial<Pick<ConnectScreenProps, 'unreachable' | 'failure' | 'unsupported' | 'noAddress'>>

function setup(onSignIn = vi.fn().mockResolvedValue(undefined), props: StateProps = {}) {
  const onRetry = vi.fn()
  const view = render(<ConnectScreen onSignIn={onSignIn} onRetry={onRetry} {...props} />, { wrapper: ToastProvider })
  /** The session's next state, as `App` renders the same screen with it. */
  const rerender = (next: StateProps) => view.rerender(<ConnectScreen onSignIn={onSignIn} onRetry={onRetry} {...next} />)
  return { onSignIn, onRetry, rerender }
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

  it('says the address answers but isn’t qBittorrent, not that qBittorrent didn’t answer', async () => {
    setup(vi.fn().mockRejectedValue(new SettingsError(502, 'not-qbittorrent')))
    const notQbittorrent = saying('The qBittorrent address on the Kinopeer server answers, but not like qBittorrent. Check QBITTORRENT_URL.')
    expect(screen.queryByRole('alert', { name: notQbittorrent })).not.toBeInTheDocument()
    await fillAndSubmit()
    expect(screen.getByRole('alert', { name: notQbittorrent })).toBeInTheDocument()
    expect(screen.queryByRole('alert', { name: saying(/answering/) })).not.toBeInTheDocument()
    // What was typed stays, for a try once the address is fixed.
    expect(screen.getByLabelText('Username')).toHaveValue('admin')
  })

  it('shows who didn’t answer the session check in place of the form, with Retry', async () => {
    const { onRetry } = setup(undefined, { unreachable: 'qbittorrent' })
    expect(screen.getByRole('heading', { name: 'qBittorrent isn’t answering' })).toBeInTheDocument()
    expect(screen.getByText('Check that qBittorrent is running and its Web UI is on.')).toBeInTheDocument()
    // No login form until there's someone to sign in to; the theme and language stay.
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('says why qBittorrent didn’t answer the session check, where the server could tell (#508)', () => {
    setup(undefined, { unreachable: 'qbittorrent', failure: 'refused' })
    expect(screen.getByRole('heading', { name: 'qBittorrent isn’t answering' })).toBeInTheDocument()
    expect(screen.getByText('Nothing listens on this port: check that qBittorrent is running, the port, and that its Web UI is on and takes connections from the network, not only from 127.0.0.1.')).toBeInTheDocument()
    expect(screen.queryByText('Check that qBittorrent is running and its Web UI is on.')).not.toBeInTheDocument()
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
    expect(screen.getByRole('alert', { name: saying('qBittorrent isn’t answering') })).toBeInTheDocument()
  })

  it('says why qBittorrent didn’t answer the sign-in at the server’s address, where the server could tell (#508)', async () => {
    setup(vi.fn().mockRejectedValue(new SettingsError(502, 'unreachable', 'timeout')))
    await fillAndSubmit()
    const alert = screen.getByRole('alert', { name: saying('qBittorrent isn’t answering') })
    expect(alert).toHaveTextContent('Nothing answered in time: a firewall may be in the way, or the host is wrong.')
    expect(alert).not.toHaveTextContent('Check that qBittorrent is running')
  })

  it('takes the server’s word that qBittorrent did not answer the sign-in, with Retry', async () => {
    const { onRetry } = setup(vi.fn().mockRejectedValue(new SettingsError(502, 'unreachable')))
    await fillAndSubmit()
    const alert = screen.getByRole('alert', { name: saying('qBittorrent isn’t answering') })
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  describe('with no address on the server', () => {
    async function fillAddress(address: string, username = '', password = '') {
      await userEvent.type(screen.getByLabelText('qBittorrent address'), address)
      if (username) await userEvent.type(screen.getByLabelText('Username'), username)
      if (password) await userEvent.type(screen.getByLabelText('Password'), password)
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    }

    it('asks for qBittorrent’s address, and a login only where qBittorrent wants one', async () => {
      const { onSignIn } = setup(undefined, { noAddress: true })
      expect(screen.getByText('Enter the address of qBittorrent’s Web UI as the Kinopeer server reaches it, and its login. The server keeps them, so you only do this once.')).toBeInTheDocument()
      expect(screen.getByLabelText('qBittorrent address')).toHaveAccessibleDescription('As the Kinopeer server reaches it, for example http://192.168.1.10:8080')
      expect(screen.getByLabelText('qBittorrent address')).toHaveAttribute('spellcheck', 'false')
      // iOS Safari autocorrects a text field otherwise (#494).
      expect(screen.getByLabelText('qBittorrent address')).toHaveAttribute('autocorrect', 'off')
      expect(screen.getByLabelText('Username')).toHaveAttribute('spellcheck', 'false')
      expect(screen.getByLabelText('Username')).toHaveAttribute('autocorrect', 'off')
      expect(screen.getByLabelText('Username')).toHaveAccessibleDescription('Leave the login empty if qBittorrent lets Kinopeer in without one.')
      expect(screen.getByLabelText('Username')).not.toBeRequired()
      expect(screen.getByLabelText('Password')).not.toBeRequired()

      // No address, nothing sent.
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
      expect(onSignIn).not.toHaveBeenCalled()
      await fillAddress('http://192.168.1.10:8080')
      expect(onSignIn).toHaveBeenCalledWith('', '', 'http://192.168.1.10:8080')
      // The server is asked nothing more: there's no address to change yet.
      expect(settings.getServerSettings).not.toHaveBeenCalled()
    })

    it('sends an address without a scheme to the server, which says what’s wrong with it', async () => {
      const { onSignIn } = setup(undefined, { noAddress: true })
      await fillAddress('192.168.1.10:8080')
      expect(onSignIn).toHaveBeenCalledWith('', '', '192.168.1.10:8080')
    })

    it('sends the login typed with the address', async () => {
      const { onSignIn } = setup(undefined, { noAddress: true })
      await fillAddress('http://qbt.test:8080', 'admin', 'secret')
      expect(onSignIn).toHaveBeenCalledWith('admin', 'secret', 'http://qbt.test:8080')
    })

    it.each([
      ['an address it refuses', new SettingsError(400, 'invalid-address'), 'Enter an address that starts with http:// or https://, with no login, ? or # in it'],
      ['an address that doesn’t answer', new SettingsError(502, 'unreachable'), 'Nothing answers at this address. Check it, and that qBittorrent is running.'],
      ['an address that doesn’t answer, and why (#508)', new SettingsError(502, 'unreachable', 'refused'), 'Nothing listens on this port: check that qBittorrent is running, the port, and that its Web UI is on and takes connections from the network, not only from 127.0.0.1.'],
    ])('says on the address field when the server finds %s, and clears it on typing', async (_name, error, message) => {
      setup(vi.fn().mockRejectedValue(error), { noAddress: true })
      await fillAddress('http://qbt.test')
      const address = screen.getByLabelText('qBittorrent address')
      expect(address).toHaveAttribute('aria-invalid', 'true')
      expect(address).toHaveAccessibleDescription(message)
      // The address is the thing to fix, not qBittorrent being down.
      expect(screen.queryByRole('alert', { name: saying(/answering/) })).not.toBeInTheDocument()
      await userEvent.type(address, '0')
      expect(address).not.toHaveAttribute('aria-invalid')
    })

    it('asks for a login when qBittorrent wants one and none was sent, and says it’s wrong when one was', async () => {
      const onSignIn = vi.fn().mockRejectedValue(new SettingsError(422, 'invalid-credentials'))
      setup(onSignIn, { noAddress: true })
      // Spaces are no login to the server either (a stray one, autofill).
      await fillAddress('http://qbt.test', ' ')
      expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('qBittorrent asks for a login: enter its username and password')
      expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true')

      await userEvent.type(screen.getByLabelText('Username'), 'admin')
      expect(screen.getByLabelText('Username')).not.toHaveAttribute('aria-invalid')
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
      expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Wrong username or password')
      expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true')
    })

    it.each([
      ['something at it that isn’t qBittorrent', new SettingsError(502, 'not-qbittorrent'), 'qBittorrent’s address answers, but not like qBittorrent. Check the address and its port.'],
      [
        'qBittorrent refusing its port (#508)',
        new SettingsError(502, 'host-refused'),
        'qBittorrent refused this address: with Host header validation on, its Web UI takes only its own port and the names in Server domains. Publish it on the same port as inside its container, add the name to Server domains, or turn the validation off.',
      ],
      ['Kinopeer’s own login off', new SettingsError(409, 'auth-off'), 'Kinopeer’s own login is off, so qBittorrent’s address can only be set on the server: QBITTORRENT_URL.'],
      ['a server that can’t write its settings', new SettingsError(500, 'storage'), 'The Kinopeer server couldn’t save the change. Check that its data folder is writable.'],
    ])('says so over the form for %s', async (_name, error, message) => {
      setup(vi.fn().mockRejectedValue(error), { noAddress: true })
      expect(screen.queryByRole('alert', { name: saying(message) })).not.toBeInTheDocument()
      await fillAddress('http://qbt.test')
      expect(screen.getByRole('alert', { name: saying(message) })).toBeInTheDocument()
      expect(screen.getByLabelText('qBittorrent address')).toHaveValue('http://qbt.test')
      // Typing stays with the fields' own errors: the banner goes with the next try.
      await userEvent.type(screen.getByLabelText('qBittorrent address'), '0')
      await userEvent.type(screen.getByLabelText('Username'), 'a')
      expect(screen.getByRole('alert', { name: saying(message) })).toBeInTheDocument()
    })

    it('checks the session again when the environment set an address meanwhile, which wins', async () => {
      const { onRetry } = setup(vi.fn().mockRejectedValue(new SettingsError(409, 'env-address')), { noAddress: true })
      await fillAddress('http://qbt.test')
      expect(onRetry).toHaveBeenCalledOnce()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('with an address saved from the app', () => {
    const saved = 'http://192.168.1.10:8080'

    it('changes it from the sign-in form: the saved one to edit, a login optional, both sent', async () => {
      vi.mocked(settings.getServerSettings).mockResolvedValue(serverSettings({ source: 'saved', url: saved }))
      const { onSignIn } = setup()
      expect(screen.queryByLabelText('qBittorrent address')).not.toBeInTheDocument()
      await userEvent.click(await screen.findByRole('button', { name: 'Change qBittorrent address' }))

      const address = screen.getByLabelText('qBittorrent address')
      expect(address).toHaveValue(saved)
      expect(screen.getByLabelText('Username')).not.toBeRequired()
      expect(screen.queryByRole('button', { name: 'Change qBittorrent address' })).not.toBeInTheDocument()
      await userEvent.clear(address)
      await userEvent.type(address, 'http://192.168.1.20:8080')
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
      expect(onSignIn).toHaveBeenCalledWith('', '', 'http://192.168.1.20:8080')
    })

    it('goes back to signing in at the saved address on Cancel, sending none', async () => {
      vi.mocked(settings.getServerSettings).mockResolvedValue(serverSettings({ source: 'saved', url: saved }))
      const { onSignIn } = setup()
      await userEvent.click(await screen.findByRole('button', { name: 'Change qBittorrent address' }))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByLabelText('qBittorrent address')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Username')).toBeRequired()
      await fillAndSubmit()
      expect(onSignIn).toHaveBeenCalledWith('admin', 'secret')
      expect(onSignIn.mock.calls[0]).toHaveLength(2)
    })

    it('signs in at the saved address until it’s changed, and names the address, not the variable, when it isn’t qBittorrent', async () => {
      vi.mocked(settings.getServerSettings).mockResolvedValue(serverSettings({ source: 'saved', url: saved }))
      const { onSignIn } = setup(vi.fn().mockRejectedValue(new SettingsError(502, 'not-qbittorrent')))
      await screen.findByRole('button', { name: 'Change qBittorrent address' })
      await fillAndSubmit()
      expect(onSignIn).toHaveBeenCalledWith('admin', 'secret')
      const notQbittorrent = saying('qBittorrent’s address answers, but not like qBittorrent. Check the address and its port.')
      expect(screen.getByRole('alert', { name: notQbittorrent })).toBeInTheDocument()
      // Changing the address is the fix, so the error goes with it.
      await userEvent.click(screen.getByRole('button', { name: 'Change qBittorrent address' }))
      expect(screen.queryByRole('alert', { name: notQbittorrent })).not.toBeInTheDocument()
    })

    it.each([
      ['qBittorrent doesn’t answer there, as a wrong one would', { unreachable: 'qbittorrent' } as const, 'qBittorrent isn’t answering'],
      ['it leads to a qBittorrent too old, which Settings can’t reach', { unsupported: '4.5.5' }, 'qBittorrent 4.5.5 is too old'],
    ])('offers to change it when %s', async (_name, state, heading) => {
      vi.mocked(settings.getServerSettings).mockResolvedValue(serverSettings({ source: 'saved', url: saved }))
      const { onSignIn, onRetry, rerender } = setup(undefined, state)
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(onRetry).toHaveBeenCalledOnce()
      await userEvent.click(await screen.findByRole('button', { name: 'Change qBittorrent address' }))

      expect(screen.getByLabelText('qBittorrent address')).toHaveValue(saved)
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
      expect(onSignIn).toHaveBeenCalledWith('', '', saved)
      // The new address leads to a qBittorrent too old as well: the screen says so, the form gone.
      rerender({ unsupported: '4.5.6' })
      expect(await screen.findByRole('heading', { name: 'qBittorrent 4.5.6 is too old' })).toBeInTheDocument()
      expect(screen.queryByLabelText('qBittorrent address')).not.toBeInTheDocument()

      // Cancel goes back to the state with Retry.
      await userEvent.click(screen.getByRole('button', { name: 'Change qBittorrent address' }))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('heading', { name: 'qBittorrent 4.5.6 is too old' })).toBeInTheDocument()
    })

    it.each([
      ['the environment sets it', serverSettings({ source: 'env' })],
      ['Kinopeer’s own login is off', serverSettings({ source: 'saved', url: saved }, { enabled: false })],
      ['the server is older and says nothing of it', { ...serverSettings({ source: 'saved', url: saved }), auth: undefined }],
    ])('offers no change when %s, since the server would refuse one', async (_name, answer) => {
      vi.mocked(settings.getServerSettings).mockResolvedValue(answer)
      setup(undefined, { unreachable: 'qbittorrent' })
      await waitFor(() => expect(settings.getServerSettings).toHaveBeenCalled())
      await act(() => Promise.resolve())
      expect(screen.queryByRole('button', { name: 'Change qBittorrent address' })).not.toBeInTheDocument()
    })

    it('asks nothing of the server while the server itself doesn’t answer', () => {
      setup(undefined, { unreachable: 'unreached' })
      setup(undefined, { unreachable: 'kinopeer' })
      expect(settings.getServerSettings).not.toHaveBeenCalled()
    })
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

  it("says when the language chosen can't be loaded, and stays in the one shown", async () => {
    setup()
    russianUnreachable()
    await userEvent.click(within(screen.getByRole('group', { name: 'Language' })).getByRole('button', { name: 'Русский' }))
    expect(await screen.findByRole('status', { name: saying(en.language.unavailable) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
  })

  it("chooses the language shown when it's tapped after another couldn't be loaded", async () => {
    setup()
    russianUnreachable()
    const language = within(screen.getByRole('group', { name: 'Language' }))
    await userEvent.click(language.getByRole('button', { name: 'Русский' }))
    expect(await screen.findByRole('status', { name: saying(en.language.unavailable) })).toBeInTheDocument()
    expect(localStorage.getItem('kinopeer.language')).toBe('ru')

    await userEvent.click(language.getByRole('button', { name: 'English' }))
    expect(localStorage.getItem('kinopeer.language')).toBe('en')
  })

  it('keeps following the browser when the language already shown is tapped', async () => {
    setup()
    const language = within(screen.getByRole('group', { name: 'Language' }))
    expect(language.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(language.getByRole('button', { name: 'English' }))
    expect(localStorage.getItem('kinopeer.language')).toBeNull()
  })
})
