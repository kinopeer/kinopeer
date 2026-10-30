import { describe, expect, it, vi } from 'vitest'
import { torrent } from '../test/fixtures'
import { createTorrentRequests, requestKey, type RequestWatcher } from './torrentRequests'

const DUNE = torrent('dune')
const ALIEN = torrent('alien')

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

const watcher = (shows: RequestWatcher['shows']) => ({ shows, settled: vi.fn<RequestWatcher['settled']>() })

describe('createTorrentRequests', () => {
  it('keeps what each request sends while it’s in flight, by kind and torrent, and tells its listeners', async () => {
    const requests = createTorrentRequests()
    const listener = vi.fn()
    requests.subscribe(listener)
    const move = request()
    const sent = requests.send('move', DUNE, '/media', () => move.promise)
    void requests.send('limits', DUNE, { download: 1 }, () => new Promise(() => {}))
    expect(requests.getSnapshot().get(requestKey('move', 'dune'))).toBe('/media')
    expect(requests.getSnapshot().get(requestKey('limits', 'dune'))).toEqual({ download: 1 })
    expect(listener).toHaveBeenCalledTimes(2)

    move.resolve()
    await sent
    expect(requests.getSnapshot().has(requestKey('move', 'dune'))).toBe(false)
    expect(requests.getSnapshot().has(requestKey('limits', 'dune'))).toBe(true)
  })

  it('sends one request of a kind for a torrent at a time, whoever asks', async () => {
    const requests = createTorrentRequests()
    const first = vi.fn(() => new Promise<void>(() => {}))
    const second = vi.fn(() => Promise.resolve())
    void requests.send('move', DUNE, '/media', first)
    // A second request could land after the first and leave the files in either folder.
    expect(await requests.send('move', DUNE, '/tv', second)).toBeUndefined()
    expect(second).not.toHaveBeenCalled()
    expect(requests.getSnapshot().get(requestKey('move', 'dune'))).toBe('/media')
    // Another torrent, or another kind, goes out.
    await expect(requests.send('move', ALIEN, '/tv', second)).resolves.toMatchObject({ ok: true })
  })

  it('hands the outcome to every watcher of the kind that shows the torrent then, and says one did', async () => {
    const requests = createTorrentRequests()
    const downloads = watcher(() => false)
    const drawer = watcher((target) => target.hash === 'dune')
    const limits = watcher(() => true)
    requests.watch('move', downloads)
    requests.watch('move', drawer)
    requests.watch('limits', limits)
    const move = request()
    const sent = requests.send('move', DUNE, '/media', () => move.promise)
    move.reject('409')
    expect(await sent).toEqual({ ok: false, error: '409', showing: true })
    expect(drawer.settled).toHaveBeenCalledWith({ ok: false, error: '409' }, '/media')
    expect(downloads.settled).not.toHaveBeenCalled()
    expect(limits.settled).not.toHaveBeenCalled()
  })

  it('says no watcher took the outcome when none shows the torrent, or one stopped watching', async () => {
    const requests = createTorrentRequests()
    const gone = watcher(() => true)
    requests.watch('move', watcher(() => false))
    const stop = requests.watch('move', gone)
    stop()
    expect(await requests.send('move', DUNE, '/media', () => Promise.resolve())).toEqual({ ok: true, showing: false })
    expect(gone.settled).not.toHaveBeenCalled()
  })
})
