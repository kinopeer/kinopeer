import { afterEach, describe, expect, it, vi } from 'vitest'
import { torrent } from '../test/fixtures'
import { mainData } from '../test/fixtures'
import { applyMainData, EMPTY_SYNC_STATE } from './sync'
import { createTorrentRequests, requestKey, withExpected, type Expectation, type RequestWatcher } from './torrentRequests'

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
    expect(drawer.settled).toHaveBeenCalledWith({ ok: false, error: '409' }, '/media', [DUNE])
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

  it('sends several torrents in one request, leaving out those with one of the kind in flight', async () => {
    const requests = createTorrentRequests()
    void requests.send('pause', DUNE, false, () => new Promise(() => {}))
    const bulk = vi.fn(() => new Promise<void>(() => {}))
    void requests.send('pause', [DUNE, ALIEN], true, bulk)
    // Dune's is on its way: a second could land after it and undo it.
    expect(bulk).toHaveBeenCalledWith(['alien'])
    expect(requests.getSnapshot().get(requestKey('pause', 'dune'))).toBe(false)
    expect(requests.getSnapshot().get(requestKey('pause', 'alien'))).toBe(true)

    const none = vi.fn(() => Promise.resolve())
    expect(await requests.send('pause', [DUNE, ALIEN], true, none)).toBeUndefined()
    expect(none).not.toHaveBeenCalled()
  })

  it('says something took the outcome of a request for several torrents only when something shows each', async () => {
    const requests = createTorrentRequests()
    const drawer = watcher((target) => target.hash === 'dune')
    requests.watch('pause', drawer)
    expect(await requests.send('pause', [DUNE, ALIEN], false, () => Promise.resolve())).toEqual({ ok: true, showing: false })
    // Told once, though it shows one of them.
    expect(drawer.settled).toHaveBeenCalledOnce()
    expect(await requests.send('pause', [DUNE], false, () => Promise.resolve())).toEqual({ ok: true, showing: true })
  })

  it('asks every watcher whether it shows the torrent before telling any, since one told may stop', async () => {
    const requests = createTorrentRequests()
    let open = true
    requests.watch('move', { shows: () => open, settled: () => (open = false) })
    const other: RequestWatcher = { shows: () => open, settled: vi.fn() }
    requests.watch('move', other)
    expect(await requests.send('move', DUNE, '/media', () => Promise.resolve())).toEqual({ ok: true, showing: true })
    expect(other.settled).toHaveBeenCalled()
  })
})

describe('createTorrentRequests with parts', () => {
  it('keeps one request per part of a torrent, so another part goes out while one is in flight', async () => {
    const requests = createTorrentRequests()
    const first = request()
    void requests.send('file', DUNE, 6, () => first.promise, { part: '0' })
    expect(await requests.send('file', DUNE, 0, () => Promise.resolve(), { part: '0' })).toBeUndefined()
    await expect(requests.send('file', DUNE, 0, () => Promise.resolve(), { part: '1' })).resolves.toMatchObject({ ok: true })
    expect(requests.getSnapshot().get(requestKey('file', 'dune', '0'))).toBe(6)
    expect(requests.getSnapshot().has(requestKey('file', 'dune'))).toBe(false)
    first.resolve()
  })
})

describe('createTorrentRequests linked to a poll', () => {
  const poll = (requestedAt: number | null = null) => ({ refresh: vi.fn(), getSnapshot: () => ({ requestedAt }) })
  const paused = (item: typeof DUNE) => ({ ...item, state: 'stoppedDL' as const })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the state a request expects from when qBittorrent took it, and polls again', async () => {
    vi.useFakeTimers({ now: 5_000 })
    const linked = poll()
    const requests = createTorrentRequests(linked)
    const stop = request()
    const sent = requests.send('pause', [DUNE, ALIEN], false, () => stop.promise, { expect: paused })
    // Not before qBittorrent took it.
    expect(requests.getExpected().size).toBe(0)
    vi.setSystemTime(7_000)
    stop.resolve()
    await sent
    expect(requests.getExpected().get(requestKey('pause', 'dune'))).toEqual({ hash: 'dune', expect: paused, until: 7_000 })
    expect(requests.getExpected().get(requestKey('pause', 'alien'))).toMatchObject({ hash: 'alien', until: 7_000 })
    expect(linked.refresh).toHaveBeenCalledOnce()
  })

  it('keeps the state for a hold after qBittorrent answered, asked how long when it answers', async () => {
    vi.useFakeTimers({ now: 5_000 })
    const requests = createTorrentRequests(poll())
    let lag = 2_000
    const stop = request()
    const sent = requests.send('pause', DUNE, false, () => stop.promise, { expect: paused, hold: () => lag })
    vi.setSystemTime(7_000)
    // Learnt while the request was on its way.
    lag = 5_500
    stop.resolve()
    await sent
    expect(requests.getExpected().get(requestKey('pause', 'dune'))).toMatchObject({ until: 12_500 })
  })

  it('expects nothing when the request failed, and polls again to show what qBittorrent has', async () => {
    const linked = poll()
    const requests = createTorrentRequests(linked)
    await requests.send('pause', DUNE, false, () => Promise.reject(new Error('500')), { expect: paused })
    expect(requests.getExpected().size).toBe(0)
    expect(linked.refresh).toHaveBeenCalledOnce()
  })

  it('leaves the poll to a request that expects no state', async () => {
    const linked = poll()
    await createTorrentRequests(linked).send('move', DUNE, '/media', () => Promise.resolve())
    expect(linked.refresh).not.toHaveBeenCalled()
  })

  it('forgets the states a poll has had its word on when it keeps a new one', async () => {
    vi.useFakeTimers({ now: 1_000 })
    let requestedAt: number | null = null
    const requests = createTorrentRequests({ refresh: vi.fn(), getSnapshot: () => ({ requestedAt }) })
    await requests.send('pause', DUNE, false, () => Promise.resolve(), { expect: paused })
    await requests.send('held', DUNE, true, () => Promise.resolve(), { expect: paused, hold: () => 1_000 })
    requestedAt = 1_000
    vi.setSystemTime(2_000)
    await requests.send('pause', ALIEN, false, () => Promise.resolve(), { expect: paused })
    // The held one's hold isn't over for the poll sent at 1 000.
    expect([...requests.getExpected().keys()]).toEqual([requestKey('held', 'dune'), requestKey('pause', 'alien')])
  })

  it('applies the states in the order qBittorrent took their requests, one sent again last', async () => {
    const requests = createTorrentRequests(poll())
    const checking = (item: typeof DUNE) => ({ ...item, state: 'checkingDL' as const })
    await requests.send('pause', DUNE, false, () => Promise.resolve(), { expect: paused })
    await requests.send('recheck', DUNE, true, () => Promise.resolve(), { expect: checking })
    await requests.send('pause', DUNE, false, () => Promise.resolve(), { expect: paused })
    const data = applyMainData(EMPTY_SYNC_STATE, mainData([DUNE]))
    expect(withExpected(data, null, requests.getExpected())?.torrents.dune.state).toBe('stoppedDL')
  })
})

describe('withExpected', () => {
  const data = applyMainData(EMPTY_SYNC_STATE, mainData([DUNE, ALIEN]))
  const pausedAt = (until: number, hash = 'dune'): [string, Expectation] => [
    requestKey('pause', hash),
    { hash, until, expect: (item) => ({ ...item, state: 'stoppedDL' }) },
  ]

  it('shows the expected state while the poll’s state is from a request sent before its time', () => {
    const shown = withExpected(data, 900, new Map([pausedAt(1_000)]))
    expect(shown?.torrents.dune.state).toBe('stoppedDL')
    expect(shown?.torrents.alien).toBe(data.torrents.alien)
  })

  it('leaves the word to a poll sent at its time or later', () => {
    expect(withExpected(data, 1_000, new Map([pausedAt(1_000)]))).toBe(data)
    expect(withExpected(data, 1_500, new Map([pausedAt(1_000)]))).toBe(data)
  })

  it('takes away a torrent a request expects gone', () => {
    const shown = withExpected(data, 900, new Map([[requestKey('delete', 'dune'), { hash: 'dune', until: 1_000, expect: () => undefined }]]))
    expect(Object.keys(shown?.torrents ?? {})).toEqual(['alien'])
    expect(data.torrents.dune).toBeDefined()
  })

  it('leaves out a torrent that went away, and has nothing to show before the first poll', () => {
    expect(withExpected(data, 900, new Map([pausedAt(1_000, 'gone')]))).toBe(data)
    expect(withExpected(null, null, new Map([pausedAt(1_000)]))).toBeNull()
  })
})
