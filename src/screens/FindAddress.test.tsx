import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as serverSettings from '../api/settings'
import { SettingsError } from '../api/settings'
import { saying } from '../test/render'
import { FindAddress } from './FindAddress'

vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof serverSettings>()),
  findAddresses: vi.fn(),
}))

const findAddresses = vi.mocked(serverSettings.findAddresses)

beforeEach(() => {
  findAddresses.mockReset()
})

function renderFind(service: 'qbittorrent' | 'prowlarr' = 'qbittorrent') {
  const onPick = vi.fn()
  const onRefused = vi.fn()
  const view = render(<FindAddress service={service} onPick={onPick} onRefused={onRefused} />)
  return { onPick, onRefused, view }
}

describe('FindAddress (#511)', () => {
  it('asks the server once while it looks, then offers each address it found to fill the field', async () => {
    let answer: (addresses: string[]) => void = () => {}
    findAddresses.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const { onPick } = renderFind()
    const find = screen.getByRole('button', { name: 'Find qBittorrent' })
    expect(find).not.toHaveAttribute('aria-busy')
    await userEvent.click(find)
    expect(find).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(find)
    expect(findAddresses).toHaveBeenCalledTimes(1)
    expect(findAddresses).toHaveBeenCalledWith('qbittorrent', expect.any(AbortSignal))

    answer(['http://qbittorrent:8080', 'http://192.168.1.20:8080'])
    expect(await screen.findByText('Found. Tap an address to use it.')).toBeInTheDocument()
    expect(find).not.toHaveAttribute('aria-busy')
    await userEvent.click(screen.getByRole('button', { name: 'http://192.168.1.20:8080' }))
    expect(onPick).toHaveBeenCalledWith('http://192.168.1.20:8080')
  })

  it('says it found nothing, and takes that back as it looks again', async () => {
    let answer: (addresses: string[]) => void = () => {}
    findAddresses.mockResolvedValueOnce([]).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    renderFind('prowlarr')
    await userEvent.click(screen.getByRole('button', { name: 'Find Prowlarr' }))
    expect(await screen.findByText('Kinopeer found no Prowlarr. Enter its address.')).toBeInTheDocument()
    expect(screen.queryByText('Found. Tap an address to use it.')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Find Prowlarr' }))
    expect(screen.queryByText(/found no Prowlarr/)).not.toBeInTheDocument()
    answer(['http://localhost:9696'])
    expect(await screen.findByRole('button', { name: 'http://localhost:9696' })).toBeInTheDocument()
  })

  it.each([
    ['no answer', new TypeError('Failed to fetch')],
    ['an answer that isn’t the server’s', new SettingsError(502)],
    ['a failure on the server', new SettingsError(500, 'storage')],
  ])('says the server couldn’t look for %s', async (_, error) => {
    findAddresses.mockRejectedValueOnce(error)
    const { onRefused } = renderFind()
    await userEvent.click(screen.getByRole('button', { name: 'Find qBittorrent' }))
    expect(await screen.findByRole('alert', { name: saying('Couldn’t reach Kinopeer. Try again.') })).toBeInTheDocument()
    expect(onRefused).not.toHaveBeenCalled()
  })

  it.each(['env-address', 'auth-off'] as const)('hands the form the server’s %s refusal to say as for a save', async (code) => {
    findAddresses.mockRejectedValueOnce(new SettingsError(409, code))
    const { onRefused } = renderFind()
    await userEvent.click(screen.getByRole('button', { name: 'Find qBittorrent' }))
    await vi.waitFor(() => expect(onRefused).toHaveBeenCalledWith(code))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Find qBittorrent' })).not.toHaveAttribute('aria-busy')
  })

  it('stops the server looking once the form is gone, and says nothing after', async () => {
    findAddresses.mockImplementationOnce(
      (_service, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    )
    const { view, onRefused } = renderFind()
    await userEvent.click(screen.getByRole('button', { name: 'Find qBittorrent' }))
    const signal = findAddresses.mock.calls[0][1]!
    view.unmount()
    expect(signal.aborted).toBe(true)
    expect(onRefused).not.toHaveBeenCalled()
  })
})
