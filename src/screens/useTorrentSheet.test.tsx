import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Torrent } from '../api/qbittorrent'
import { torrent } from '../test/fixtures'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import { useTorrentSheet } from './useTorrentSheet'

const DUNE = torrent('dune')

type Torrents = Record<string, Torrent> | undefined

function renderSheet() {
  return renderHook(({ list }: { list: Torrents }) => useTorrentSheet<string>('move', list), {
    initialProps: { list: { dune: DUNE } as Torrents },
  })
}

describe('useTorrentSheet', () => {
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

  it.each<[string, (view: ReturnType<typeof renderSheet>) => void]>([
    ['closed', (view) => act(() => view.result.current.close())],
    ['gone', (view) => view.rerender({ list: {} })],
    ['replaced', (view) => view.rerender({ list: { dune: { ...DUNE, added_on: DUNE.added_on + 60 } } })],
    ['its screen left', (view) => view.unmount()],
  ])('says no sheet shows a request’s torrent once it was %s', async (_case, leave) => {
    const view = renderSheet()
    act(() => view.result.current.open('dune'))
    const pending = request()
    const sent = view.result.current.send(DUNE, 'a', () => pending.promise)
    leave(view)
    await act(async () => pending.resolve())
    expect(await sent).toEqual({ ok: true, showing: false })
  })

  it('keeps a failed request for the sheet that shows its torrent, with what it sent, until a sheet opens or sends again', async () => {
    const { result } = renderSheet()
    act(() => result.current.open('dune'))
    const first = request()
    const sent = result.current.send(DUNE, '/root', () => first.promise)
    await act(async () => first.reject('403'))
    await sent
    expect(result.current.failure).toEqual({ sent: '/root', error: '403' })

    const second = request()
    act(() => void result.current.send(DUNE, '/media', () => second.promise))
    expect(result.current.failure).toBeUndefined()
    await act(async () => second.reject('409'))
    expect(result.current.failure).toEqual({ sent: '/media', error: '409' })
    act(() => result.current.open('dune'))
    expect(result.current.failure).toBeUndefined()
  })

  it('keeps the failure a sheet shows when a request for a torrent no sheet shows fails, as that one’s said elsewhere', async () => {
    const alien = torrent('alien')
    const { result } = renderHook(() => useTorrentSheet<string>('move', { dune: DUNE, alien }))
    act(() => result.current.open('dune'))
    const dune = request()
    let duneSent!: Promise<unknown>
    act(() => {
      duneSent = result.current.send(DUNE, '/media', () => dune.promise)
    })
    act(() => result.current.open('alien'))
    const other = request()
    act(() => void result.current.send(alien, '/tv', () => other.promise))
    await act(async () => other.reject('403'))
    await act(async () => dune.reject('409'))
    expect(await duneSent).toEqual({ ok: false, error: '409', showing: false })
    expect(result.current.failure).toEqual({ sent: '/tv', error: '403' })
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
    const { result } = renderHook(() => useTorrentSheet<string>('move', { dune: DUNE, alien }))
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

describe('useTorrentSheet on two screens under one TorrentRequestsProvider', () => {
  /** Downloads and the drawer over it, each with its own sheet of the same kind. */
  function renderScreens() {
    return renderHook(
      () => ({
        downloads: useTorrentSheet<string>('move', { dune: DUNE }),
        drawer: useTorrentSheet<string>('move', { dune: DUNE }),
      }),
      { wrapper: TorrentRequestsProvider },
    )
  }

  it('shows a request sent from one screen busy on the other, and closes the other’s sheet once it goes through', async () => {
    const { result } = renderScreens()
    const sending = request()
    let sent!: Promise<unknown>
    act(() => {
      sent = result.current.downloads.send(DUNE, '/media', () => sending.promise)
    })
    act(() => result.current.drawer.open('dune'))
    expect(result.current.drawer.pending('dune')).toBe('/media')
    // It doesn't go out a second time from there.
    expect(await result.current.drawer.send(DUNE, '/tv', () => Promise.resolve())).toBeUndefined()

    await act(async () => sending.resolve())
    expect(await sent).toEqual({ ok: true, showing: true })
    expect(result.current.drawer.torrent).toBeUndefined()
  })

  it('keeps the failure in the other screen’s sheet, which then says it', async () => {
    const { result } = renderScreens()
    const sending = request()
    let sent!: Promise<unknown>
    act(() => {
      sent = result.current.downloads.send(DUNE, '/media', () => sending.promise)
    })
    act(() => result.current.drawer.open('dune'))
    await act(async () => sending.reject('409'))
    expect(await sent).toEqual({ ok: false, error: '409', showing: true })
    expect(result.current.drawer.failure).toEqual({ sent: '/media', error: '409' })
    expect(result.current.downloads.failure).toBeUndefined()
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
