import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as serverSettings from '../api/settings'
import type { ServerSettings } from '../api/settings'
import { TmdbKeyForm } from './TmdbKeyForm'
import { saying } from '../test/render'

vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof serverSettings>()),
  saveTmdbKey: vi.fn(),
  forgetTmdbKey: vi.fn(),
}))

const saveTmdbKey = vi.mocked(serverSettings.saveTmdbKey)
const forgetTmdbKey = vi.mocked(serverSettings.forgetTmdbKey)

const SAVED: ServerSettings = {
  tmdb: { configured: true, source: 'saved', fallback: 'shared' },
  prowlarr: { configured: true, source: 'env', serverKey: true },
  qbittorrent: { configured: true, source: 'env' },
  downloads: null,
}

const SHARED: ServerSettings = { ...SAVED, tmdb: { configured: true, source: 'shared', fallback: 'shared' } }

function renderForm() {
  const onSaved = vi.fn()
  render(<TmdbKeyForm onSaved={onSaved} secondary={<button type="button">Skip for now</button>} />)
  return { onSaved, field: screen.getByLabelText('API key or read access token'), save: screen.getByRole('button', { name: 'Save' }) }
}

function renderForgetting(to: 'shared' | 'env' = 'shared') {
  const onSaved = vi.fn()
  const onForgotten = vi.fn()
  render(<TmdbKeyForm onSaved={onSaved} forget={{ to, onForgotten }} />)
  return { onSaved, onForgotten, field: screen.getByLabelText('API key or read access token'), save: screen.getByRole('button', { name: 'Save' }) }
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
    // One request at a time: Enter again while it's saving sends nothing more.
    await userEvent.type(field, '{Enter}')
    expect(saveTmdbKey).toHaveBeenCalledTimes(1)

    finish(SAVED)
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED))
  })

  it('submits through the server, not as the browser would', async () => {
    const { field } = renderForm()
    await userEvent.type(field, 'abc123')
    // The browser's own submission would reload the page; fireEvent says whether it was prevented.
    expect(fireEvent.submit(field.closest('form')!)).toBe(false)
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
    ['storage', 'The Kinoseed server couldn’t save the change. Check that its data folder is writable.'],
    ['not-configured', 'Couldn’t save the key. Try again.'],
  ] as const)('explains a failure to save (%s) in a banner, leaving the key as it is', async (code, message) => {
    saveTmdbKey.mockRejectedValue(new serverSettings.SettingsError(502, code))
    const { field, save } = renderForm()
    await userEvent.type(field, 'abc123')
    await userEvent.click(save)
    expect(screen.getByRole('alert', { name: saying(message) })).toBeInTheDocument()
    expect(field).not.toHaveAttribute('aria-invalid')
    expect(field).toHaveValue('abc123')

    // Nothing but a SettingsError's code tells the failures apart: a network error is "failed" too.
    saveTmdbKey.mockRejectedValue(new TypeError('Failed to fetch'))
    await userEvent.click(save)
    expect(screen.getByRole('alert', { name: saying('Couldn’t save the key. Try again.') })).toBeInTheDocument()
  })

  it.each([
    ['shared', 'Use Kinoseed’s key'],
    ['env', 'Use the server’s key'],
  ] as const)('goes back to the key the server falls back on (%s) and hands the settings on', async (to, label) => {
    forgetTmdbKey.mockResolvedValue(SHARED)
    const { onForgotten, onSaved } = renderForgetting(to)
    await userEvent.click(screen.getByRole('button', { name: label }))
    await vi.waitFor(() => expect(onForgotten).toHaveBeenCalledWith(SHARED))
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('has no forget button unless there is a key to go back to', () => {
    renderForm()
    expect(screen.queryByRole('button', { name: /^Use .* key$/ })).not.toBeInTheDocument()
  })

  it.each([
    ['storage', 'The Kinoseed server couldn’t save the change. Check that its data folder is writable.'],
    ['no-server-key', 'Kinoseed has no other TMDB key to use, so the saved one stays.'],
    [undefined, 'Couldn’t forget the key. Try again.'],
    // Not the field's "invalid key": forgetting sends no key.
    ['bad-request', 'Couldn’t forget the key. Try again.'],
  ] as const)('says why the key could not be forgotten (%s), and can try again', async (code, message) => {
    forgetTmdbKey.mockRejectedValueOnce(code ? new serverSettings.SettingsError(500, code) : new Error('network'))
    forgetTmdbKey.mockResolvedValueOnce(SHARED)
    const { onForgotten } = renderForgetting()
    const forget = screen.getByRole('button', { name: 'Use Kinoseed’s key' })
    await userEvent.click(forget)
    expect(await screen.findByRole('alert', { name: saying(message) })).toBeInTheDocument()
    expect(screen.getByLabelText('API key or read access token')).not.toHaveAttribute('aria-invalid')
    expect(forget).not.toHaveAttribute('aria-busy')
    expect(onForgotten).not.toHaveBeenCalled()

    await userEvent.click(forget)
    await vi.waitFor(() => expect(onForgotten).toHaveBeenCalledWith(SHARED))
  })

  it('disables forgetting while saving', async () => {
    let finishSave = (_settings: ServerSettings) => {}
    saveTmdbKey.mockReturnValue(new Promise((resolve) => (finishSave = resolve)))
    const { field, save, onSaved } = renderForgetting()
    const forget = screen.getByRole('button', { name: 'Use Kinoseed’s key' })
    await userEvent.type(field, 'abc123')
    await userEvent.click(save)
    expect(forget).toBeDisabled()

    finishSave(SAVED)
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED))
  })

  it('disables Save while forgetting, busy meanwhile', async () => {
    forgetTmdbKey.mockReturnValue(new Promise(() => {}))
    const { save } = renderForgetting()
    const forget = screen.getByRole('button', { name: 'Use Kinoseed’s key' })
    await userEvent.click(forget)
    expect(forget).toHaveAttribute('aria-busy', 'true')
    expect(save).toBeDisabled()
  })
})
