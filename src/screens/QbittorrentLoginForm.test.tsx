import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import * as serverSettings from '../api/settings'
import { SettingsError } from '../api/settings'
import { ToastProvider } from '../components/Toast'
import { held } from '../test/held'
import { findToastOnPage, saying } from '../test/render'
import { QbittorrentLoginForm, type QbittorrentLoginFormProps } from './QbittorrentLoginForm'

vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof serverSettings>()),
  findAddresses: vi.fn(),
}))

const findAddresses = vi.mocked(serverSettings.findAddresses)

// What the form does is tested through the connect screen, which also has Retry and Change;
// here only what differs where it stands alone, as in Settings' sheet.
describe('QbittorrentLoginForm', () => {
  it('says who didn’t answer without Retry when it has none to offer', async () => {
    render(<QbittorrentLoginForm className="key-form" askAddress onSubmit={vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))} onEnvAddress={vi.fn()} />, { wrapper: ToastProvider })
    await userEvent.type(screen.getByLabelText('qBittorrent address'), 'http://qbt.test')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    const banner = await screen.findByRole('alert', { name: saying(/Kinopeer/) })
    expect(banner).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('is busy only while the server checks, sends nothing more meanwhile, and takes the last error back as it tries again', async () => {
    const banned = saying('Too many failed attempts. qBittorrent has blocked this address for a while.')
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new SettingsError(403, 'banned'))
      .mockReturnValueOnce(new Promise<void>(() => {}))
    render(<QbittorrentLoginForm className="key-form" onSubmit={onSubmit} onEnvAddress={vi.fn()} />, { wrapper: ToastProvider })
    const connect = screen.getByRole('button', { name: 'Connect' })
    expect(connect).not.toHaveAttribute('aria-busy')
    await userEvent.type(screen.getByLabelText('Username'), 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'secret')
    await userEvent.click(connect)
    expect(await screen.findByRole('alert', { name: banned })).toBeInTheDocument()
    expect(connect).not.toHaveAttribute('aria-busy')

    await userEvent.click(connect)
    expect(connect).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('alert', { name: banned })).not.toBeInTheDocument()
    // Enter again while it's checked: a wrong password would count twice toward qBittorrent's ban.
    await userEvent.type(screen.getByLabelText('Password'), '{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  describe('Find (#511)', () => {
    it('fills the address with one Find found, which takes back the error and the hint on it', async () => {
      const onSubmit = vi.fn().mockRejectedValue(new SettingsError(502, 'unreachable', 'refused', { container: { hostAddress: 'http://host.docker.internal:8080' } }))
      findAddresses.mockResolvedValue(['http://qbittorrent:8080'])
      render(<QbittorrentLoginForm className="key-form" askAddress onSubmit={onSubmit} onEnvAddress={vi.fn()} />, { wrapper: ToastProvider })
      const address = screen.getByLabelText('qBittorrent address')
      await userEvent.type(address, 'http://localhost:8080')
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
      await vi.waitFor(() => expect(address).toHaveAttribute('aria-invalid', 'true'))
      expect(screen.getByRole('button', { name: 'Use this address' })).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Find qBittorrent' }))
      await userEvent.click(await screen.findByRole('button', { name: 'http://qbittorrent:8080' }))
      expect(address).toHaveValue('http://qbittorrent:8080')
      expect(address).not.toHaveAttribute('aria-invalid')
      expect(screen.queryByRole('button', { name: 'Use this address' })).not.toBeInTheDocument()
    })

    it('says the server’s refusals of Find as for a connect', async () => {
      const onEnvAddress = vi.fn()
      findAddresses.mockRejectedValueOnce(new SettingsError(409, 'auth-off')).mockRejectedValueOnce(new SettingsError(409, 'env-address'))
      render(<QbittorrentLoginForm className="key-form" askAddress onSubmit={vi.fn()} onEnvAddress={onEnvAddress} />, { wrapper: ToastProvider })
      const find = screen.getByRole('button', { name: 'Find qBittorrent' })
      await userEvent.click(find)
      expect(await screen.findByRole('alert', { name: saying('Kinopeer’s own login is off, so qBittorrent’s address can only be set on the server: QBITTORRENT_URL.') })).toBeInTheDocument()
      expect(onEnvAddress).not.toHaveBeenCalled()
      await userEvent.click(find)
      await vi.waitFor(() => expect(onEnvAddress).toHaveBeenCalledTimes(1))
    })

    it('isn’t offered where the form doesn’t ask for the address', () => {
      render(<QbittorrentLoginForm className="key-form" onSubmit={vi.fn()} onEnvAddress={vi.fn()} />, { wrapper: ToastProvider })
      expect(screen.queryByRole('button', { name: 'Find qBittorrent' })).not.toBeInTheDocument()
    })
  })
})

const SETTINGS: serverSettings.ServerSettings = {
  tmdb: { configured: true, source: 'shared', fallback: null },
  prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
  qbittorrent: { configured: true, source: 'saved', address: { source: 'saved', url: 'http://qbt.test' } },
  downloads: null,
}

const caller = () => ({ onSaved: vi.fn(), onEnvAddress: vi.fn() })

/**
 * The form under a Close that takes it away and an Open that brings it back, as Settings' sheet does:
 * the form opened again has a caller of its own, as Settings opened again would.
 */
function renderClosable(onSubmit: QbittorrentLoginFormProps['onSubmit'], askAddress = true) {
  const callers = [caller(), caller()]
  function Sheet() {
    const [open, setOpen] = useState(true)
    const [opened, setOpened] = useState(0)
    const { onSaved, onEnvAddress } = callers[Math.min(opened, 1)]
    const toggle = () => {
      if (!open) setOpened(opened + 1)
      setOpen(!open)
    }
    return (
      <>
        <button type="button" onClick={toggle}>
          {open ? 'Close' : 'Open'}
        </button>
        {open && (
          <QbittorrentLoginForm className="key-form" askAddress={askAddress} initialAddress="http://saved.test" onSubmit={onSubmit} onSaved={onSaved} onEnvAddress={onEnvAddress} />
        )}
      </>
    )
  }
  render(<Sheet />, { wrapper: ToastProvider })
  return { sender: callers[0], again: callers[1], toggle: () => userEvent.click(screen.getByRole('button', { name: /^(Close|Open)$/ })) }
}

const connectAs = async (address: string, username: string) => {
  await userEvent.clear(screen.getByLabelText('qBittorrent address'))
  await userEvent.type(screen.getByLabelText('qBittorrent address'), address)
  await userEvent.type(screen.getByLabelText('Username'), username)
  await userEvent.type(screen.getByLabelText('Password'), 'secret')
  await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
}

describe('QbittorrentLoginForm: a check that settles after the form is gone (#500)', () => {
  it.each([
    ['a refused login', new SettingsError(401, 'invalid-credentials'), 'admin', 'qBittorrent didn’t accept the username or password.'],
    ['no login where one is wanted', new SettingsError(401, 'invalid-credentials'), '', 'qBittorrent asks for a login: enter its username and password'],
    ['a ban', new SettingsError(403, 'banned'), 'admin', 'Too many failed attempts. qBittorrent has blocked this address for a while.'],
    ['something else at the address', new SettingsError(502, 'not-qbittorrent'), 'admin', 'qBittorrent’s address answers, but not like qBittorrent. Check the address and its port.'],
    ['the Host header refused', new SettingsError(502, 'host-refused'), 'admin', /^qBittorrent refused this address: with Host header validation on/],
    ['the login off', new SettingsError(409, 'auth-off'), 'admin', 'Kinopeer’s own login is off, so qBittorrent’s address can only be set on the server: QBITTORRENT_URL.'],
    ['the settings unwritable', new SettingsError(500, 'storage'), 'admin', 'The Kinopeer server couldn’t save the change. Check that its data folder is writable.'],
    ['nothing listening at the address', new SettingsError(502, 'unreachable', 'refused'), 'admin', /^Nothing listens on this port: check that qBittorrent is running/],
    ['no answer from the address, with no cause', new SettingsError(502, 'unreachable'), 'admin', 'Nothing answers at this address. Check it, and that qBittorrent is running.'],
    ['no answer from Kinopeer', new TypeError('Failed to fetch'), 'admin', 'Couldn’t save the qBittorrent connection. Try again.'],
  ])('says %s in a toast, as the form would', async (_name, error, username, message) => {
    const check = held<serverSettings.ServerSettings>()
    const { toggle } = renderClosable(() => check.promise)
    await userEvent.clear(screen.getByLabelText('qBittorrent address'))
    await userEvent.type(screen.getByLabelText('qBittorrent address'), 'http://qbt.test')
    if (username) {
      await userEvent.type(screen.getByLabelText('Username'), username)
      await userEvent.type(screen.getByLabelText('Password'), 'secret')
    }
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await toggle()
    await act(async () => check.reject(error))
    expect(await findToastOnPage(message)).toBeInTheDocument()
  })

  it.each([
    ['why qBittorrent didn’t answer', new SettingsError(502, 'unreachable', 'refused'), /^Nothing listens on this port: check that qBittorrent is running/],
    ['something else at the server’s address', new SettingsError(502, 'not-qbittorrent'), 'The qBittorrent address on the Kinopeer server answers, but not like qBittorrent. Check QBITTORRENT_URL.'],
  ])('asking for no address, says %s in a toast, as the form would', async (_name, error, message) => {
    const check = held<serverSettings.ServerSettings>()
    const { toggle } = renderClosable(() => check.promise, false)
    await userEvent.type(screen.getByLabelText('Username'), 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await toggle()
    await act(async () => check.reject(error))
    expect(await findToastOnPage(message)).toBeInTheDocument()
  })

  it('leaves the environment’s address to the caller, which says it', async () => {
    const check = held<serverSettings.ServerSettings>()
    const { sender, toggle } = renderClosable(() => check.promise)
    await connectAs('http://qbt.test', 'admin')
    await toggle()
    await act(async () => check.reject(new SettingsError(409, 'env-address')))
    expect(sender.onEnvAddress).toHaveBeenCalledOnce()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('hands a save to the caller that sent it, saying nothing itself', async () => {
    const check = held<serverSettings.ServerSettings>()
    const { sender, toggle } = renderClosable(() => check.promise)
    await connectAs('http://qbt.test', 'admin')
    await toggle()
    await act(async () => check.resolve(SETTINGS))
    expect(sender.onSaved).toHaveBeenCalledExactlyOnceWith(SETTINGS)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('opened again meanwhile, starts busy from what was sent, sends nothing more and says the failure itself', async () => {
    const check = held<serverSettings.ServerSettings>()
    const onSubmit = vi.fn(() => check.promise)
    const { toggle } = renderClosable(onSubmit)
    await connectAs('http://qbt.test', 'admin')
    await toggle()
    await toggle()

    const connect = screen.getByRole('button', { name: 'Connect' })
    expect(connect).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByLabelText('qBittorrent address')).toHaveValue('http://qbt.test')
    expect(screen.getByLabelText('Username')).toHaveValue('admin')
    await userEvent.type(screen.getByLabelText('Password'), 'secret{Enter}')
    expect(onSubmit).toHaveBeenCalledOnce()
    await userEvent.clear(screen.getByLabelText('Username'))

    await act(async () => check.reject(new SettingsError(401, 'invalid-credentials')))
    // The login that was sent is what qBittorrent refused, not a missing one, whatever the field says now.
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(/Wrong username or password/)
    expect(connect).not.toHaveAttribute('aria-busy')
    expect(screen.queryByRole('status', { name: saying('Couldn’t save the qBittorrent connection. Try again.') })).not.toBeInTheDocument()
  })

  it('keeps what it says while a check is on its way, however often Connect is pressed', async () => {
    const check = held<serverSettings.ServerSettings>()
    findAddresses.mockRejectedValue(new SettingsError(409, 'auth-off'))
    renderClosable(() => check.promise)
    await connectAs('http://qbt.test', 'admin')
    await userEvent.click(screen.getByRole('button', { name: 'Find qBittorrent' }))
    const authOff = saying('Kinopeer’s own login is off, so qBittorrent’s address can only be set on the server: QBITTORRENT_URL.')
    expect(await screen.findByRole('alert', { name: authOff })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Password'), '{Enter}')
    expect(screen.getByRole('alert', { name: authOff })).toBeInTheDocument()
    await act(async () => check.resolve(SETTINGS))
  })

  it('opened again meanwhile, hands a save to its own caller, not the one that sent it, and shows nothing failed', async () => {
    const check = held<serverSettings.ServerSettings>()
    const { sender, again, toggle } = renderClosable(() => check.promise)
    await connectAs('http://qbt.test', 'admin')
    await toggle()
    await toggle()
    await act(async () => check.resolve(SETTINGS))
    expect(again.onSaved).toHaveBeenCalledExactlyOnceWith(SETTINGS)
    expect(sender.onSaved).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('qBittorrent address')).not.toHaveAttribute('aria-invalid')
  })
})

/** The connect screen's form, which Change and Cancel start afresh, asking for the address or not. */
function renderChangeable(onSubmit: QbittorrentLoginFormProps['onSubmit'], startAsking: boolean) {
  function Connect() {
    const [ask, setAsk] = useState(startAsking)
    return (
      <>
        <button type="button" onClick={() => setAsk(!ask)}>
          {ask ? 'Cancel' : 'Change'}
        </button>
        <QbittorrentLoginForm key={String(ask)} className="key-form" askAddress={ask} onSubmit={onSubmit} onEnvAddress={vi.fn()} />
      </>
    )
  }
  render(<Connect />, { wrapper: ToastProvider })
}

describe('QbittorrentLoginForm: started afresh while a check is on its way (#500)', () => {
  it('leaves a refused address to a toast once the form asks for none', async () => {
    const check = held<serverSettings.ServerSettings>()
    renderChangeable(() => check.promise, true)
    await connectAs('http://qbt.test', 'admin')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Connect' })).toHaveAttribute('aria-busy', 'true')
    await act(async () => check.reject(new SettingsError(400, 'invalid-address')))
    expect(await findToastOnPage('Enter an address that starts with http:// or https://, with no login, ? or # in it')).toBeInTheDocument()
  })

  it('says qBittorrent didn’t answer a login sent without an address over the form, not on the address asked for since', async () => {
    const check = held<serverSettings.ServerSettings>()
    renderChangeable(() => check.promise, false)
    await userEvent.type(screen.getByLabelText('Username'), 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await userEvent.click(screen.getByRole('button', { name: 'Change' }))
    await act(async () => check.reject(new SettingsError(502, 'unreachable')))
    expect(screen.getByRole('alert', { name: saying(/qBittorrent isn’t answering/) })).toBeInTheDocument()
    expect(screen.getByLabelText('qBittorrent address')).not.toHaveAttribute('aria-invalid')
  })
})
