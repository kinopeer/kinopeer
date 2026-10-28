import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Torrent } from '../api/qbittorrent'
import { torrent } from '../test/fixtures'
import { useTorrentSheet } from './useTorrentSheet'

const DUNE = torrent('dune')

type Torrents = Record<string, Torrent> | undefined

function renderSheet() {
  return renderHook(({ list }: { list: Torrents }) => useTorrentSheet(list), {
    initialProps: { list: { dune: DUNE } as Torrents },
  })
}

describe('useTorrentSheet', () => {
  it('opens for a torrent among the screen’s, and not for one that isn’t', () => {
    const { result } = renderSheet()
    act(() => result.current.open('alien'))
    expect(result.current.torrent).toBeUndefined()
    act(() => result.current.open('dune'))
    expect(result.current.torrent).toBe(DUNE)
    act(() => result.current.close())
    expect(result.current.torrent).toBeUndefined()
  })

  it('closes when its torrent goes away, and stays closed when it’s back', () => {
    const { result, rerender } = renderSheet()
    act(() => result.current.open('dune'))
    rerender({ list: {} })
    expect(result.current.torrent).toBeUndefined()
    rerender({ list: { dune: DUNE } })
    expect(result.current.torrent).toBeUndefined()
  })

  it('stays open while the screen has no torrents yet, as before its first answer', () => {
    const { result, rerender } = renderSheet()
    act(() => result.current.open('dune'))
    rerender({ list: undefined })
    expect(result.current.torrent).toBeUndefined()
    rerender({ list: { dune: DUNE } })
    expect(result.current.torrent).toBe(DUNE)
  })

  it('closes when another torrent with the same hash replaces its torrent between two polls', () => {
    const { result, rerender } = renderSheet()
    act(() => result.current.open('dune'))
    const readded = { ...DUNE, added_on: DUNE.added_on + 60 }
    rerender({ list: { dune: readded } })
    expect(result.current.torrent).toBeUndefined()
    // Not even once the first one would be back.
    rerender({ list: { dune: DUNE } })
    expect(result.current.torrent).toBeUndefined()
  })

  it('says whether a sheet shows a torrent, for a request that settles later', () => {
    const { result, rerender, unmount } = renderSheet()
    act(() => result.current.open('dune'))
    expect(result.current.showing(DUNE)).toBe(true)
    act(() => result.current.close())
    expect(result.current.showing(DUNE)).toBe(false)
    // Opened again for the same torrent: that sheet shows what the closed one sent.
    act(() => result.current.open('dune'))
    expect(result.current.showing(DUNE)).toBe(true)

    const readded = { ...DUNE, added_on: DUNE.added_on + 60 }
    rerender({ list: { dune: readded } })
    expect(result.current.showing(DUNE)).toBe(false)
    expect(result.current.showing(readded)).toBe(false)

    act(() => result.current.open('dune'))
    expect(result.current.showing(readded)).toBe(true)
    unmount()
    expect(result.current.showing(readded)).toBe(false)
  })

  it('says no sheet shows a torrent that went away, though its sheet was never closed', () => {
    const { result, rerender } = renderSheet()
    act(() => result.current.open('dune'))
    rerender({ list: {} })
    expect(result.current.showing(DUNE)).toBe(false)
    // Back with the same added_on, its sheet stays closed, so a late request says so elsewhere.
    rerender({ list: { dune: DUNE } })
    expect(result.current.showing(DUNE)).toBe(false)
  })
})
