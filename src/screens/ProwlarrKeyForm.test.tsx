import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as serverSettings from '../api/settings'
import type { ServerSettings } from '../api/settings'
import { ProwlarrKeyForm } from './ProwlarrKeyForm'
import { saying } from '../test/render'

vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof serverSettings>()),
  saveProwlarrKey: vi.fn(),
  forgetProwlarrKey: vi.fn(),
  findAddresses: vi.fn(),
}))

const saveProwlarrKey = vi.mocked(serverSettings.saveProwlarrKey)
const forgetProwlarrKey = vi.mocked(serverSettings.forgetProwlarrKey)
const findAddresses = vi.mocked(serverSettings.findAddresses)

const SAVED: ServerSettings = {
  tmdb: { configured: true, source: 'saved', fallback: null },
  prowlarr: { configured: true, source: 'saved', serverKey: true, address: { source: 'env' } },
  qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
  downloads: null,
}

const SERVER: ServerSettings = { ...SAVED, prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } } }

function renderForm(canForget = false) {
  const onSaved = vi.fn()
  const onForgotten = vi.fn()
  render(<ProwlarrKeyForm onSaved={onSaved} onForgotten={onForgotten} canForget={canForget} />)
  return {
    onSaved,
    onForgotten,
    field: screen.getByLabelText('Prowlarr API key'),
    save: screen.getByRole('button', { name: 'Save' }),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  saveProwlarrKey.mockResolvedValue(SAVED)
})

describe('ProwlarrKeyForm', () => {
  it('saves the trimmed key and hands the settings on', async () => {
    const { onSaved, field, save } = renderForm()
    // A key is machine text: no autocorrect (iOS Safari's, #494) or spell check.
    expect(field).toHaveAttribute('autocorrect', 'off')
    expect(field).toHaveAttribute('spellcheck', 'false')
    await userEvent.type(field, '  abc123  ')
    await userEvent.click(save)
    expect(saveProwlarrKey).toHaveBeenCalledWith('abc123')
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED))
  })

  it.each([
    [422, 'invalid-key'],
    [400, 'bad-request'],
  ] as const)('marks the key invalid when the server refuses it (%s %s), until it is edited', async (status, code) => {
    saveProwlarrKey.mockRejectedValue(new serverSettings.SettingsError(status, code))
    const { onSaved, field, save } = renderForm()
    await userEvent.type(field, 'wrong')
    await userEvent.click(save)
    expect(await screen.findByText('Prowlarr didn’t accept this key')).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(onSaved).not.toHaveBeenCalled()

    await userEvent.type(field, 'x')
    expect(screen.queryByText('Prowlarr didn’t accept this key')).not.toBeInTheDocument()
  })

  it.each([
    ['unreachable', 'Prowlarr isn’t answering. Check that it’s running and try again.'],
    ['not-configured', 'The Kinopeer server doesn’t know Prowlarr’s address (PROWLARR_URL).'],
    ['not-prowlarr', 'The Prowlarr address on the Kinopeer server answers, but not like Prowlarr. Check PROWLARR_URL.'],
    ['storage', 'The Kinopeer server couldn’t save the change. Check that its data folder is writable.'],
    [undefined, 'Couldn’t save the key. Try again.'],
  ] as const)('says why the key could not be saved (%s), and only that', async (code, message) => {
    saveProwlarrKey.mockRejectedValue(new serverSettings.SettingsError(502, code))
    const { field, save } = renderForm()
    await userEvent.type(field, 'abc123')
    await userEvent.click(save)
    expect(await screen.findByRole('alert', { name: saying(message) })).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('says why Prowlarr didn’t answer at the server’s address, where the server could tell (#508)', async () => {
    saveProwlarrKey.mockRejectedValue(new serverSettings.SettingsError(502, 'unreachable', 'name'))
    const { field, save } = renderForm()
    await userEvent.type(field, 'abc123')
    await userEvent.click(save)
    const alert = await screen.findByRole('alert', { name: saying('Prowlarr isn’t answering') })
    expect(alert).toHaveTextContent('Kinopeer’s server can’t find this host. Check the name, or use the IP address.')
    expect(alert).not.toHaveTextContent('Check that it’s running')
  })

  it("goes back to the server's key and hands the settings on", async () => {
    forgetProwlarrKey.mockResolvedValue(SERVER)
    const { onForgotten, onSaved } = renderForm(true)
    await userEvent.click(screen.getByRole('button', { name: 'Use the server’s key' }))
    await vi.waitFor(() => expect(onForgotten).toHaveBeenCalledWith(SERVER))
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('has no forget button unless the form may forget', () => {
    renderForm()
    expect(screen.queryByRole('button', { name: 'Use the server’s key' })).not.toBeInTheDocument()
  })

  it.each([
    ['storage', 'The Kinopeer server couldn’t save the change. Check that its data folder is writable.'],
    ['no-server-key', 'The Kinopeer server has no Prowlarr key of its own, so the saved one stays.'],
    [undefined, 'Couldn’t switch to the server’s key. Try again.'],
  ] as const)('says why the key could not be forgotten (%s), and can try again', async (code, message) => {
    forgetProwlarrKey.mockRejectedValueOnce(code ? new serverSettings.SettingsError(500, code) : new Error('network'))
    forgetProwlarrKey.mockResolvedValueOnce(SERVER)
    const { onForgotten } = renderForm(true)
    const forget = screen.getByRole('button', { name: 'Use the server’s key' })
    await userEvent.click(forget)
    expect(await screen.findByRole('alert', { name: saying(message) })).toBeInTheDocument()
    expect(onForgotten).not.toHaveBeenCalled()

    await userEvent.click(forget)
    await vi.waitFor(() => expect(onForgotten).toHaveBeenCalledWith(SERVER))
  })

  it('disables forgetting while saving', async () => {
    let finishSave = (_settings: ServerSettings) => {}
    saveProwlarrKey.mockReturnValue(new Promise((resolve) => (finishSave = resolve)))
    const { field, save, onSaved } = renderForm(true)
    const forget = screen.getByRole('button', { name: 'Use the server’s key' })
    await userEvent.type(field, 'abc123')
    await userEvent.click(save)
    expect(forget).toBeDisabled()

    finishSave(SAVED)
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED))
  })

  describe('with Prowlarr’s address to ask', () => {
    const LOCALHOST = saying('localhost is inside Kinopeer’s container')

    function renderWithAddress(secondary?: ReactNode) {
      const onSaved = vi.fn()
      const onEnvAddress = vi.fn()
      render(<ProwlarrKeyForm onSaved={onSaved} onEnvAddress={onEnvAddress} askAddress secondary={secondary} />)
      return { onSaved, onEnvAddress, address: screen.getByLabelText('Prowlarr address'), field: screen.getByLabelText('Prowlarr API key'), save: screen.getByRole('button', { name: 'Save' }) }
    }

    it('saves the address with the key, which is trimmed', async () => {
      const { onSaved, address, field, save } = renderWithAddress()
      expect(address).toHaveAccessibleDescription('As the Kinopeer server reaches it, for example http://192.168.1.10:9696')
      expect(address).toHaveAttribute('spellcheck', 'false')
      // iOS Safari autocorrects a text field otherwise (#494).
      expect(address).toHaveAttribute('autocorrect', 'off')
      // Onboarding has no key of the server's to go back to.
      expect(screen.queryByRole('button', { name: 'Use the server’s key' })).not.toBeInTheDocument()
      await userEvent.type(field, ' abc123 ')
      await userEvent.click(save)
      // Both are needed.
      expect(saveProwlarrKey).not.toHaveBeenCalled()
      await userEvent.type(address, 'http://prowlarr.test:9696')
      await userEvent.click(save)
      expect(saveProwlarrKey).toHaveBeenCalledWith('abc123', 'http://prowlarr.test:9696')
      await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED))
    })

    it.each([
      ['an address it refuses', new serverSettings.SettingsError(400, 'invalid-address'), 'Enter an address that starts with http:// or https://, with no login, ? or # in it'],
      ['an address that doesn’t answer', new serverSettings.SettingsError(502, 'unreachable'), 'Nothing answers at this address. Check it, and that Prowlarr is running.'],
      ['an address that doesn’t answer, and why (#508)', new serverSettings.SettingsError(502, 'unreachable', 'http'), 'Prowlarr answers here without HTTPS: start the address with http://.'],
    ])('says on the address field when the server finds %s, and clears it on typing', async (_name, error, message) => {
      saveProwlarrKey.mockRejectedValue(error)
      const { address, field, save } = renderWithAddress()
      await userEvent.type(address, 'http://prowlarr.test')
      await userEvent.type(field, 'abc123')
      await userEvent.click(save)
      await vi.waitFor(() => expect(address).toHaveAccessibleDescription(message))
      expect(address).toHaveAttribute('aria-invalid', 'true')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      await userEvent.type(address, '0')
      expect(address).not.toHaveAttribute('aria-invalid')
    })

    it('takes the hint back once another address is typed, so Use this address can’t replace it (#509)', async () => {
      saveProwlarrKey.mockRejectedValueOnce(new serverSettings.SettingsError(502, 'not-prowlarr', undefined, { container: { hostAddress: 'http://host.docker.internal:9696' } }))
      const { address, field, save } = renderWithAddress()
      await userEvent.type(address, 'http://localhost:9696')
      await userEvent.type(field, 'abc123')
      await userEvent.click(save)
      expect(await screen.findByRole('status', { name: LOCALHOST })).toBeInTheDocument()
      await userEvent.type(address, '1')
      expect(screen.queryByRole('status', { name: LOCALHOST })).not.toBeInTheDocument()
    })

    it.each([
      ['doesn’t answer', new serverSettings.SettingsError(502, 'unreachable', 'refused', { container: { hostAddress: 'http://host.docker.internal:9696' } })],
      ['answers as something else', new serverSettings.SettingsError(502, 'not-prowlarr', undefined, { container: { hostAddress: 'http://host.docker.internal:9696' } })],
    ])('says localhost is Kinopeer’s container when Prowlarr there %s, and puts the host’s address in on a tap (#509)', async (_, error) => {
      saveProwlarrKey.mockRejectedValueOnce(error)
      const { address, field, save } = renderWithAddress()
      await userEvent.type(address, 'http://localhost:9696')
      await userEvent.type(field, 'abc123')
      await userEvent.click(save)
      const hint = await screen.findByRole('status', { name: LOCALHOST })
      expect(
        within(hint).getByText(
          'In Kinopeer’s container, localhost and 127.0.0.1 lead into the container itself, not to the computer it runs on. From the container, that computer is at http://host.docker.internal:9696. If Prowlarr runs in a container on a shared Docker network, enter that container’s name instead.',
        ),
      ).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Use this address' }))
      expect(address).toHaveValue('http://host.docker.internal:9696')
      expect(screen.queryByRole('status', { name: LOCALHOST })).not.toBeInTheDocument()
      await userEvent.click(save)
      expect(saveProwlarrKey).toHaveBeenLastCalledWith('abc123', 'http://host.docker.internal:9696')
    })

    it('says nothing of the container for a refused key, or without the server’s word (#509)', async () => {
      saveProwlarrKey.mockRejectedValueOnce(new serverSettings.SettingsError(422, 'invalid-key', undefined, { container: {} }))
      saveProwlarrKey.mockRejectedValueOnce(new serverSettings.SettingsError(502, 'unreachable', 'refused'))
      const { address, field, save } = renderWithAddress()
      await userEvent.type(address, 'http://localhost:9696')
      await userEvent.type(field, 'abc123')
      await userEvent.click(save)
      await vi.waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
      expect(screen.queryByRole('status', { name: LOCALHOST })).not.toBeInTheDocument()
      await userEvent.click(save)
      await vi.waitFor(() => expect(address).toHaveAttribute('aria-invalid', 'true'))
      expect(screen.queryByRole('status', { name: LOCALHOST })).not.toBeInTheDocument()
    })

    it('names the address, not the variable, when it isn’t Prowlarr, and keeps a refused key on the key', async () => {
      saveProwlarrKey.mockRejectedValueOnce(new serverSettings.SettingsError(502, 'not-prowlarr'))
      saveProwlarrKey.mockRejectedValueOnce(new serverSettings.SettingsError(422, 'invalid-key'))
      const { address, field, save } = renderWithAddress()
      await userEvent.type(address, 'http://prowlarr.test')
      await userEvent.type(field, 'abc123')
      await userEvent.click(save)
      const notProwlarr = saying('Prowlarr’s address answers, but not like Prowlarr. Check the address and its port.')
      expect(await screen.findByRole('alert', { name: notProwlarr })).toBeInTheDocument()
      // Typing clears only the address field's own errors: the banner goes with the next try.
      await userEvent.type(address, '0')
      expect(screen.getByRole('alert', { name: notProwlarr })).toBeInTheDocument()
      await userEvent.click(save)
      await vi.waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
      expect(address).not.toHaveAttribute('aria-invalid')
    })

    it('sends an address without a scheme to the server, which says what’s wrong with it', async () => {
      const { address, field, save } = renderWithAddress()
      await userEvent.type(address, '192.168.1.10:9696')
      await userEvent.type(field, 'abc123')
      await userEvent.click(save)
      expect(saveProwlarrKey).toHaveBeenCalledWith('abc123', '192.168.1.10:9696')
    })

    it.each([
      ['the environment set Prowlarr’s address meanwhile', new serverSettings.SettingsError(409, 'env-address'), 'Prowlarr’s address is now set on the Kinopeer server (PROWLARR_URL), which wins over one from the app.', 1],
      ['Kinopeer’s own login is off', new serverSettings.SettingsError(409, 'auth-off'), 'Kinopeer’s own login is off, so Prowlarr’s address can only be set on the server: PROWLARR_URL.', 0],
    ])('says what refused the address when %s, rather than to try again', async (_name, error, message, envAddressCalls) => {
      saveProwlarrKey.mockRejectedValue(error)
      const { onEnvAddress, address, field, save } = renderWithAddress()
      await userEvent.type(address, 'http://prowlarr.test')
      await userEvent.type(field, 'abc123')
      await userEvent.click(save)
      expect(await screen.findByRole('alert', { name: saying(message) })).toBeInTheDocument()
      expect(screen.queryByRole('alert', { name: saying('Couldn’t save the key. Try again.') })).not.toBeInTheDocument()
      // Only the environment's address has the settings asked again.
      expect(onEnvAddress).toHaveBeenCalledTimes(envAddressCalls)
    })

    it('fills the address with one Find found, which takes back the error on it (#511)', async () => {
      saveProwlarrKey.mockRejectedValue(new serverSettings.SettingsError(502, 'unreachable'))
      findAddresses.mockResolvedValue(['http://prowlarr:9696'])
      const { address, field, save } = renderWithAddress()
      await userEvent.type(address, 'http://localhost:9696')
      await userEvent.type(field, 'abc123')
      await userEvent.click(save)
      await vi.waitFor(() => expect(address).toHaveAttribute('aria-invalid', 'true'))
      await userEvent.click(screen.getByRole('button', { name: 'Find Prowlarr' }))
      await userEvent.click(await screen.findByRole('button', { name: 'http://prowlarr:9696' }))
      expect(address).toHaveValue('http://prowlarr:9696')
      expect(address).not.toHaveAttribute('aria-invalid')
    })

    it.each([
      ['env-address', 'Prowlarr’s address is now set on the Kinopeer server (PROWLARR_URL), which wins over one from the app.', 1],
      ['auth-off', 'Kinopeer’s own login is off, so Prowlarr’s address can only be set on the server: PROWLARR_URL.', 0],
    ] as const)('says the server’s %s refusal of Find as for a save', async (code, message, envAddressCalls) => {
      findAddresses.mockRejectedValue(new serverSettings.SettingsError(409, code))
      const { onEnvAddress } = renderWithAddress()
      await userEvent.click(screen.getByRole('button', { name: 'Find Prowlarr' }))
      expect(await screen.findByRole('alert', { name: saying(message) })).toBeInTheDocument()
      expect(onEnvAddress).toHaveBeenCalledTimes(envAddressCalls)
    })

    it('offers another action under Save', () => {
      renderWithAddress(<button type="button">Skip</button>)
      expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument()
    })
  })

  it('says nothing of the container where it doesn’t ask for the address (#509)', async () => {
    saveProwlarrKey.mockRejectedValue(new serverSettings.SettingsError(502, 'not-prowlarr', undefined, { container: { hostAddress: 'http://host.docker.internal:9696' } }))
    renderForm()
    await userEvent.type(screen.getByLabelText('Prowlarr API key'), 'abc123')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('offers no Find where it doesn’t ask for the address (#511)', () => {
    renderForm()
    expect(screen.queryByRole('button', { name: 'Find Prowlarr' })).not.toBeInTheDocument()
  })

  it('names the address, not the variable, when one saved from the app isn’t Prowlarr', async () => {
    saveProwlarrKey.mockRejectedValue(new serverSettings.SettingsError(502, 'not-prowlarr'))
    render(<ProwlarrKeyForm onSaved={vi.fn()} addressFromApp />)
    await userEvent.type(screen.getByLabelText('Prowlarr API key'), 'abc123')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert', { name: saying('Prowlarr’s address answers, but not like Prowlarr. Check the address and its port.') })).toBeInTheDocument()
    expect(screen.queryByLabelText('Prowlarr address')).not.toBeInTheDocument()
  })

  it('disables Save while forgetting', async () => {
    forgetProwlarrKey.mockReturnValue(new Promise(() => {}))
    const { save } = renderForm(true)
    await userEvent.click(screen.getByRole('button', { name: 'Use the server’s key' }))
    expect(save).toBeDisabled()
  })
})
