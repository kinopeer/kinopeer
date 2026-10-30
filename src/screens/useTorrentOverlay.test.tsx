import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Torrent } from '../api/qbittorrent'
import { torrent } from '../test/fixtures'
import { useTorrentOverlay } from './useTorrentOverlay'

const DUNE = torrent('dune')

type Torrents = Record<string, Torrent> | undefined

function renderOverlay() {
  return renderHook(({ list }: { list: Torrents }) => useTorrentOverlay(list), {
    initialProps: { list: { dune: DUNE } as Torrents },
  })
}

describe('useTorrentOverlay', () => {
  it('opens for a torrent among the screen’s, and not for one that isn’t', () => {
    const { result } = renderOverlay()
    act(() => void expect(result.current.open('alien')).toBeUndefined())
    expect(result.current.torrent).toBeUndefined()
    act(() => void expect(result.current.open('dune')).toBe(DUNE))
    expect(result.current.torrent).toBe(DUNE)
    act(() => result.current.close())
    expect(result.current.torrent).toBeUndefined()
  })

  it('closes when its torrent goes away, and stays closed when it’s back', () => {
    const { result, rerender } = renderOverlay()
    act(() => result.current.open('dune'))
    rerender({ list: {} })
    expect(result.current.torrent).toBeUndefined()
    rerender({ list: { dune: DUNE } })
    expect(result.current.torrent).toBeUndefined()
  })

  it('stays open while the screen has no torrents yet, as before its first answer', () => {
    const { result, rerender } = renderOverlay()
    act(() => result.current.open('dune'))
    rerender({ list: undefined })
    expect(result.current.torrent).toBeUndefined()
    rerender({ list: { dune: DUNE } })
    expect(result.current.torrent).toBe(DUNE)
  })

  it('closes when another torrent with the same hash replaces its torrent between two polls', () => {
    const { result, rerender } = renderOverlay()
    act(() => result.current.open('dune'))
    const readded = { ...DUNE, added_on: DUNE.added_on + 60 }
    rerender({ list: { dune: readded } })
    expect(result.current.torrent).toBeUndefined()
    // Not even once the first one would be back.
    rerender({ list: { dune: DUNE } })
    expect(result.current.torrent).toBeUndefined()
  })
})
