import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as serverSettings from '../api/settings'
import type { ServerSettings } from '../api/settings'
import { ProwlarrKeyForm } from './ProwlarrKeyForm'

vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof serverSettings>()),
  saveProwlarrKey: vi.fn(),
}))

const saveProwlarrKey = vi.mocked(serverSettings.saveProwlarrKey)

const SAVED: ServerSettings = {
  tmdb: { configured: true, source: 'saved' },
  prowlarr: { configured: true, source: 'saved' },
  qbittorrent: { configured: true, source: 'env' },
  downloads: null,
}

function renderForm() {
  const onSaved = vi.fn()
  render(<ProwlarrKeyForm onSaved={onSaved} />)
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

  it('marks the key invalid when Prowlarr refuses it, until it is edited', async () => {
    saveProwlarrKey.mockRejectedValue(new serverSettings.SettingsError(422, 'invalid-key'))
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
  ] as const)('says why the key could not be saved (%s)', async (code, message) => {
    saveProwlarrKey.mockRejectedValue(new serverSettings.SettingsError(502, code))
    const { field, save } = renderForm()
    await userEvent.type(field, 'abc123')
    await userEvent.click(save)
    expect(await screen.findByText(message)).toBeInTheDocument()
  })
})
