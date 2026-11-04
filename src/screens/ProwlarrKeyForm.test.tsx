import { render, screen } from '@testing-library/react'
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
}))

const saveProwlarrKey = vi.mocked(serverSettings.saveProwlarrKey)
const forgetProwlarrKey = vi.mocked(serverSettings.forgetProwlarrKey)

const SAVED: ServerSettings = {
  tmdb: { configured: true, source: 'saved', fallback: null },
  prowlarr: { configured: true, source: 'saved', serverKey: true },
  qbittorrent: { configured: true, source: 'env' },
  downloads: null,
}

const SERVER: ServerSettings = { ...SAVED, prowlarr: { configured: true, source: 'env', serverKey: true } }

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
    ['not-prowlarr', 'The Prowlarr address on the Kinoseed server answers, but not like Prowlarr. Check PROWLARR_URL.'],
    ['storage', 'The Kinoseed server couldn’t save the change. Check that its data folder is writable.'],
    [undefined, 'Couldn’t save the key. Try again.'],
  ] as const)('says why the key could not be saved (%s)', async (code, message) => {
    saveProwlarrKey.mockRejectedValue(new serverSettings.SettingsError(502, code))
    const { field, save } = renderForm()
    await userEvent.type(field, 'abc123')
    await userEvent.click(save)
    expect(await screen.findByRole('alert', { name: saying(message) })).toBeInTheDocument()
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
    ['storage', 'The Kinoseed server couldn’t save the change. Check that its data folder is writable.'],
    ['no-server-key', 'The Kinoseed server has no Prowlarr key of its own, so the saved one stays.'],
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

  it('disables Save while forgetting', async () => {
    forgetProwlarrKey.mockReturnValue(new Promise(() => {}))
    const { save } = renderForm(true)
    await userEvent.click(screen.getByRole('button', { name: 'Use the server’s key' }))
    expect(save).toBeDisabled()
  })
})
