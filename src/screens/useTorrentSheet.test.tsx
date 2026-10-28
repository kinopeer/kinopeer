import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Torrent } from '../api/qbittorrent'
import { torrent } from '../test/fixtures'
import { useTorrentSheet } from './useTorrentSheet'

const DUNE = torrent('dune')

type Torrents = Record<string, Torrent> | undefined

function renderSheet() {
  return renderHook(({ list }: { list: Torrents }) => useTorrentSheet<string>(list), {
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

  it('says a request’s sheet still shows its torrent when it settles while open, or opened again since', async () => {
    const { result } = renderSheet()
    act(() => result.current.open('dune'))
    const open = request()
    const whileOpen = result.current.send(DUNE, 'a', () => open.promise)
    await act(async () => open.resolve())
    expect(await whileOpen).toEqual({ ok: true, showing: true })

    const reopened = request()
    const sent = result.current.send(DUNE, 'b', () => reopened.promise)
    act(() => result.current.close())
    act(() => result.current.open('dune'))
    await act(async () => reopened.reject('500'))
    expect(await sent).toEqual({ ok: false, error: '500', showing: true })
  })

  it('says no sheet shows a request’s torrent once it was closed, gone, replaced or its screen left', async () => {
    const readded = { ...DUNE, added_on: DUNE.added_on + 60 }
    const cases: [string, (view: ReturnType<typeof renderSheet>) => void][] = [
      ['closed', (view) => act(() => view.result.current.close())],
      ['gone', (view) => view.rerender({ list: {} })],
      ['replaced', (view) => view.rerender({ list: { dune: readded } })],
      ['left', (view) => view.unmount()],
    ]
    for (const [, leave] of cases) {
      const view = renderSheet()
      act(() => view.result.current.open('dune'))
      const pending = request()
      const sent = view.result.current.send(DUNE, 'a', () => pending.promise)
      leave(view)
      await act(async () => pending.resolve())
      expect(await sent).toEqual({ ok: true, showing: false })
      view.unmount()
    }
  })

  it('knows a sheet was closed or opened as soon as it’s asked, before React renders it', async () => {
    const { result } = renderSheet()
    act(() => result.current.open('dune'))
    const first = request()
    const closed = result.current.send(DUNE, 'a', () => first.promise)
    // A sheet dragged away closes when its animation ends, outside an event React renders at once:
    // a request that settles before that render still learns the sheet is gone.
    await act(async () => {
      result.current.close()
      first.resolve()
      expect(await closed).toEqual({ ok: true, showing: false })
    })

    const second = request()
    const opened = result.current.send(DUNE, 'b', () => second.promise)
    await act(async () => {
      result.current.open('dune')
      second.resolve()
      expect(await opened).toEqual({ ok: true, showing: true })
    })
  })

  it('keeps each torrent’s request pending until that one settles', async () => {
    const alien = torrent('alien')
    const { result } = renderHook(() => useTorrentSheet<string>({ dune: DUNE, alien }))
    const dune = request()
    const other = request()
    let sent!: Promise<unknown>
    act(() => {
      sent = result.current.send(DUNE, '/movies', () => dune.promise)
      void result.current.send(alien, '/tv', () => other.promise)
    })
    expect(result.current.pending('dune')).toBe('/movies')
    expect(result.current.pending('alien')).toBe('/tv')
    await act(async () => dune.reject(new Error('500')))
    await sent
    expect(result.current.pending('dune')).toBeUndefined()
    // Settling another torrent's request doesn't end this one.
    expect(result.current.pending('alien')).toBe('/tv')
  })
})

/** A request that settles when the test says so. */
function request() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
