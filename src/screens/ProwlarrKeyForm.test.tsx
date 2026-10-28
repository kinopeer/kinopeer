import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as serverSettings from '../api/settings'
import type { ServerSettings } from '../api/settings'
import { ProwlarrKeyForm } from './ProwlarrKeyForm'

vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof serverSettings>()),
  saveProwlarrKey: vi.fn(),
  forgetProwlarrKey: vi.fn(),
}))

const saveProwlarrKey = vi.mocked(serverSettings.saveProwlarrKey)

const SAVED: ServerSettings = {
  tmdb: { configured: true, source: 'saved' },
  prowlarr: { configured: true, source: 'saved' },
  qbittorrent: { configured: true, source: 'env' },
  downloads: null,
}

function renderForm(saved = false) {
  const onSaved = vi.fn()
  render(<ProwlarrKeyForm onSaved={onSaved} saved={saved} />)
  return { onSaved, field: screen.getByLabelText('Prowlarr API key'), save: screen.getByRole('button', { name: 'Save' }) }
}

beforeEach(() => {
  vi.resetAllMocks()
  saveProwlarrKey.mockResolvedValue(SAVED)
})

describe('ProwlarrKeyForm', () => {
  it('saves the trimmed key and hands the settings on', async () => {
    const { onSaved, field, save } = renderForm()
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
    ['not-configured', 'The Kinoseed server doesn’t know Prowlarr’s address (PROWLARR_URL).'],
    ['storage', 'The Kinoseed server couldn’t save the key. Check that its data folder is writable.'],
    [undefined, 'Couldn’t save the key. Try again.'],
  ] as const)('says why the key could not be saved (%s)', async (code, message) => {
    saveProwlarrKey.mockRejectedValue(new serverSettings.SettingsError(502, code))
    const { field, save } = renderForm()
    await userEvent.type(field, 'abc123')
    await userEvent.click(save)
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it("offers to forget a saved key for the server's own only while one is saved", async () => {
    const SERVER: ServerSettings = { ...SAVED, prowlarr: { configured: true, source: 'env' } }
    vi.mocked(serverSettings.forgetProwlarrKey).mockResolvedValue(SERVER)
    const { onSaved } = renderForm(true)
    await userEvent.click(screen.getByRole('button', { name: 'Use the server’s key' }))
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(SERVER))
    expect(saveProwlarrKey).not.toHaveBeenCalled()
  })

  it('has no forget button without a saved key', () => {
    renderForm()
    expect(screen.queryByRole('button', { name: 'Use the server’s key' })).not.toBeInTheDocument()
  })
})
