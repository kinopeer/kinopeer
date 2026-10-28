import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { TorrentMeta } from '../torrents/torrentFile'
import { FilePicker } from './FilePicker'

const META: TorrentMeta = {
  infoHash: 'abc123',
  name: 'Breaking Bad',
  files: [
    { path: 'Season 1/e01.mkv', size: 10e9 },
    { path: 'Season 2/e01.mkv', size: 20e9 },
    { path: 'Season 2/e02.mkv', size: 20e9 },
  ],
  totalSize: 50e9,
}

function Harness({ free, onDone = vi.fn() }: { free?: number; onDone?: () => void }) {
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set())
  return <FilePicker meta={META} skipped={skipped} onChange={setSkipped} free={free} subtitle="Breaking.Bad.S01-S02" onDone={onDone} />
}

function renderPicker(props: { free?: number; onDone?: () => void } = {}) {
  render(<Harness {...props} />)
  return within(screen.getByRole('dialog', { name: 'Select files' }))
}

describe('FilePicker', () => {
  it('lists the files as a tree of seasons, inside the torrent’s own folder, all selected', () => {
    const picker = renderPicker()
    expect(picker.getByText('Breaking.Bad.S01-S02')).toBeInTheDocument()
    expect(picker.queryByRole('checkbox', { name: 'Breaking Bad' })).not.toBeInTheDocument()
    expect(picker.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))).toEqual(['Season 1', 'Season 2'])
    expect(picker.getByRole('button', { name: /Season 2/ })).toHaveTextContent('2 files · 40.0 GB')
    expect(picker.getByText('3 of 3 · 50.0 GB')).toBeInTheDocument()
  })

  it('selects a folder’s files together, and shows a folder with some of them as mixed', async () => {
    const picker = renderPicker()
    await userEvent.click(picker.getByRole('checkbox', { name: 'Season 1' }))
    expect(picker.getByRole('checkbox', { name: 'Season 1' })).toHaveAttribute('aria-checked', 'false')
    expect(picker.getByText('2 of 3 · 40.0 GB')).toBeInTheDocument()

    await userEvent.click(picker.getByRole('button', { name: /Season 2/ }))
    await userEvent.click(picker.getByRole('checkbox', { name: 'e02.mkv' }))
    const season2 = picker.getByRole('checkbox', { name: 'Season 2' })
    expect(season2).toHaveAttribute('aria-checked', 'mixed')
    expect(picker.getByRole('button', { name: /Season 2/ })).toHaveTextContent('1/2')
    expect(picker.getByText('1 of 3 · 20.0 GB')).toBeInTheDocument()

    // Checking a mixed folder takes all of it.
    await userEvent.click(season2)
    expect(season2).toHaveAttribute('aria-checked', 'true')
    expect(picker.getByText('2 of 3 · 40.0 GB')).toBeInTheDocument()
  })

  it('selects everything or nothing with one button, and needs at least one file', async () => {
    const picker = renderPicker()
    await userEvent.click(picker.getByRole('button', { name: 'None' }))
    expect(picker.getByText('0 of 3 · 0 B')).toBeInTheDocument()
    expect(picker.getByRole('button', { name: 'Done' })).toBeDisabled()
    expect(picker.getAllByRole('checkbox').map((box) => box.getAttribute('aria-checked'))).toEqual(['false', 'false'])

    await userEvent.click(picker.getByRole('button', { name: 'Select all' }))
    expect(picker.getByText('3 of 3 · 50.0 GB')).toBeInTheDocument()
    expect(picker.getByRole('button', { name: 'Done' })).toBeEnabled()
  })

  it('warns when the selection doesn’t fit the free space', async () => {
    const picker = renderPicker({ free: 40e9 })
    expect(picker.getByText('Not enough free space')).toBeInTheDocument()
    expect(picker.getByRole('progressbar', { name: 'Selected size against free space' })).toHaveAttribute('aria-valuenow', '100')

    await userEvent.click(picker.getByRole('checkbox', { name: 'Season 1' }))
    expect(picker.queryByText('Not enough free space')).not.toBeInTheDocument()
    expect(picker.getByText('Free: 40.0 GB')).toBeInTheDocument()
  })

  it.each([undefined, 0, -1])('says nothing about free space when qBittorrent reports %s', (free) => {
    const picker = renderPicker({ free })
    expect(picker.queryByText(/free space|Free:/)).not.toBeInTheDocument()
    expect(picker.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('goes back with Done or Back', async () => {
    const onDone = vi.fn()
    const picker = renderPicker({ onDone })
    await userEvent.click(picker.getByRole('button', { name: 'Back' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    await userEvent.click(picker.getByRole('button', { name: 'Done' }))
    expect(onDone).toHaveBeenCalledTimes(2)
  })
})
