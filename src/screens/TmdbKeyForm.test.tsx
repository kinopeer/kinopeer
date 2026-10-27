import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as serverSettings from '../api/settings'
import type { ServerSettings } from '../api/settings'
import { TmdbKeyForm } from './TmdbKeyForm'

vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof serverSettings>()),
  saveTmdbKey: vi.fn(),
}))

const saveTmdbKey = vi.mocked(serverSettings.saveTmdbKey)

const SAVED: ServerSettings = {
  tmdb: { configured: true, source: 'saved' },
  qbittorrent: { configured: true, source: 'env' },
  downloads: null,
}

function renderForm() {
  const onSaved = vi.fn()
  render(<TmdbKeyForm onSaved={onSaved} secondary={<button type="button">Skip for now</button>} />)
  return { onSaved, field: screen.getByLabelText('API key or read access token'), save: screen.getByRole('button', { name: 'Save' }) }
}

beforeEach(() => {
  vi.resetAllMocks()
  saveTmdbKey.mockResolvedValue(SAVED)
})

describe('TmdbKeyForm', () => {
  it('saves the trimmed key, busy meanwhile, and hands the settings on', async () => {
    let finish = (_settings: ServerSettings) => {}
    saveTmdbKey.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const { onSaved, field, save } = renderForm()
    expect(screen.getByRole('link', { name: 'Open TMDB API settings' })).toHaveAttribute('href', 'https://www.themoviedb.org/settings/api')
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()

    await userEvent.type(field, '  abc123  ')
    await userEvent.click(save)
    expect(saveTmdbKey).toHaveBeenCalledWith('abc123')
    expect(save).toHaveAttribute('aria-busy', 'true')

    finish(SAVED)
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED))
  })

  it('needs a key', async () => {
    const { save } = renderForm()
    await userEvent.click(save)
    expect(saveTmdbKey).not.toHaveBeenCalled()
  })

  it.each(['invalid-key', 'bad-request'] as const)('marks the key invalid when TMDB refuses it (%s), until it is edited', async (code) => {
    saveTmdbKey.mockRejectedValue(new serverSettings.SettingsError(422, code))
    const { onSaved, field, save } = renderForm()
    await userEvent.type(field, 'wrong')
    await userEvent.click(save)
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription(/TMDB didn’t accept this key/)
    expect(save).not.toHaveAttribute('aria-busy')
    expect(onSaved).not.toHaveBeenCalled()

    await userEvent.type(field, 'x')
    expect(field).not.toHaveAttribute('aria-invalid')
  })

  it.each([
    ['unreachable', 'TMDB isn’t answering. Try again in a moment.'],
    ['storage', 'The Kinoseed server couldn’t save the key. Check that its data folder is writable.'],
    ['not-configured', 'Couldn’t save the key. Try again.'],
  ] as const)('explains a failure to save (%s) in a banner, leaving the key as it is', async (code, message) => {
    saveTmdbKey.mockRejectedValue(new serverSettings.SettingsError(502, code))
    const { field, save } = renderForm()
    await userEvent.type(field, 'abc123')
    await userEvent.click(save)
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(field).not.toHaveAttribute('aria-invalid')
    expect(field).toHaveValue('abc123')

    // Nothing but a SettingsError's code tells the failures apart: a network error is "failed" too.
    saveTmdbKey.mockRejectedValue(new TypeError('Failed to fetch'))
    await userEvent.click(save)
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t save the key. Try again.')
  })
})
