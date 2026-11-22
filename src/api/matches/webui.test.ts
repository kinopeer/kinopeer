import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { isStoreFull } from '../qbittorrent/webui'
import { clearGuesses, getMatches, saveMatches } from './client'
import { MATCH_KEY_PREFIX, clearWebuiGuesses, loadWebuiMatches, pruneWebuiMatches, saveWebuiMatches } from './webui'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const V2 = 'c'.repeat(64)

const USER = { type: 'movie', id: 1, source: 'user' } as const
const GUESS = { type: 'tv', id: 2, source: 'guess', version: 2 } as const
const MISS = { source: 'miss', version: 2 } as const

const key = (hash: string) => MATCH_KEY_PREFIX + hash

let fetchMock: Mock<typeof fetch>

/** What the fake qBittorrent keeps in its store, merged as qBittorrent 5.3 does (src/api/qbittorrent/webui.test.ts). */
let kept: Record<string, unknown>

/** The `data` of each `clientdata/store` sent. */
const stored = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/clientdata/store'))
    .map(([, init]) => JSON.parse(new URLSearchParams(String(init!.body)).get('data')!) as Record<string, unknown>)

interface Hold {
  /** Settles once the held store has reached the fake. */
  reached: Promise<void>
  /** Lets the held store through. */
  release: () => void
}

/** Stores the fake holds, in order: each reaches it, then waits until the test releases it. */
let holds: { reach: () => void; released: Promise<void> }[]
/** Every hold's release, so one a failed test left held doesn't hold the next test's changes. */
let releases: (() => void)[]

/** Holds the next store until the test releases it. */
function holdNextStore(): Hold {
  let reach = () => {}
  let release = () => {}
  const reached = new Promise<void>((resolve) => (reach = resolve))
  const released = new Promise<void>((resolve) => (release = resolve))
  holds.push({ reach, released })
  releases.push(release)
  return { reached, release }
}

beforeEach(() => {
  kept = {}
  holds = []
  releases = []
  fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    const target = new URL(String(url), 'http://192.168.1.20:8080/')
    if (target.pathname === '/api/v2/clientdata/load') {
      // Without keys, qBittorrent answers every key it keeps.
      const keys = target.searchParams.has('keys') ? (JSON.parse(target.searchParams.get('keys')!) as string[]) : Object.keys(kept)
      return Response.json(Object.fromEntries(keys.filter((name) => name in kept).map((name) => [name, kept[name]])))
    }
    if (target.pathname === '/api/v2/clientdata/store') {
      const data = JSON.parse(new URLSearchParams(String(init!.body)).get('data')!) as Record<string, unknown>
      // A store the test holds reaches qBittorrent when it lets it through.
      const hold = holds.shift()
      if (hold) {
        hold.reach()
        await hold.released
      }
      for (const [name, value] of Object.entries(data)) {
        if (value === null) delete kept[name]
        else kept[name] = value
      }
      return new Response(null, { status: 204 })
    }
    return new Response('Not Found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('__WEBUI__', true)
})

afterEach(async () => {
  // The page's changes wait for each other (changeMatches), so one a test left held would hold the rest.
  for (const release of releases) release()
  vi.useRealTimers()
})

describe('loadWebuiMatches', () => {
  it('reads every torrent’s match from its own key, unknown before it’s loaded, leaving out what isn’t one', async () => {
    kept = {
      [key(A)]: USER,
      [key(V2)]: { ...GUESS, missingSince: 1000 },
      // Another interface's keys, Kinopeer's settings, and keys of the prefix that hold no match.
      'other.ui': { theme: 'dark' },
      // Another interface's key that ends in a hash, as long as Kinopeer's prefix.
      [`${'x'.repeat(MATCH_KEY_PREFIX.length)}${B}`]: USER,
      'kinopeer.tmdbKey': 'abc',
      [key('not-a-hash')]: USER,
      [key(B)]: { type: 'movie', source: 'user' },
    }
    await expect(loadWebuiMatches()).resolves.toEqual({ [A]: USER, [V2]: { ...GUESS, missingSince: 1000 } })
  })

  it('passes the caller’s signal on', async () => {
    fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))))
    const caller = new AbortController()
    const load = loadWebuiMatches(caller.signal)
    caller.abort()
    await expect(load).rejects.toThrow()
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true)
  })
})

describe('saveWebuiMatches', () => {
  it('stores only the matches the rules let change, and forgets those set to null, answering every match', async () => {
    kept = { [key(A)]: USER, [key(B)]: GUESS, 'other.ui': 1 }
    await expect(saveWebuiMatches({ [A]: GUESS, [B]: null, [V2]: MISS })).resolves.toEqual({ [A]: USER, [V2]: MISS })
    expect(stored()).toEqual([{ [key(B)]: null, [key(V2)]: MISS }])
    expect(kept).toEqual({ [key(A)]: USER, [key(V2)]: MISS, 'other.ui': 1 })
  })

  it('reads what qBittorrent keeps before each change, so a match another device saved stays', async () => {
    await saveWebuiMatches({ [A]: GUESS })
    // Another device chose a title for A meanwhile.
    kept[key(A)] = USER
    await expect(saveWebuiMatches({ [A]: { ...GUESS, id: 3 } })).resolves.toEqual({ [A]: USER })
    expect(stored()).toEqual([{ [key(A)]: GUESS }])
  })

  it('stores nothing when the rules change nothing', async () => {
    kept = { [key(A)]: USER }
    await expect(saveWebuiMatches({ [A]: GUESS, [B]: null })).resolves.toEqual({ [A]: USER })
    expect(stored()).toEqual([])
  })

  it('stores nothing when it can’t read what qBittorrent keeps', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
    await expect(saveWebuiMatches({ [A]: USER })).rejects.toMatchObject({ status: 502 })
    expect(stored()).toEqual([])
  })

  it('fails as qBittorrent refused the store, a full one among them', async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith('/clientdata/store') ? new Response('Conflict', { status: 409 }) : Response.json({}),
    )
    const error = await saveWebuiMatches({ [A]: USER }).catch((reason: unknown) => reason)
    expect(isStoreFull(error)).toBe(true)
  })
})

describe('one page’s changes', () => {
  it('go one at a time, so a choice picked while a guess batch is being stored stays', async () => {
    vi.useFakeTimers()
    const hold = holdNextStore()
    const guess = saveWebuiMatches({ [A]: GUESS })
    await hold.reached
    const choice = saveWebuiMatches({ [A]: USER })
    // The choice goes as far as it can while the guess batch's store is held.
    await vi.runAllTimersAsync()
    hold.release()
    await expect(guess).resolves.toEqual({ [A]: GUESS })
    await expect(choice).resolves.toEqual({ [A]: USER })
    expect(kept[key(A)]).toEqual(USER)
  })

  it('go one at a time, so a torrent forgotten while a prune is being stored stays forgotten', async () => {
    vi.useFakeTimers()
    kept = { [key(A)]: GUESS }
    const hold = holdNextStore()
    const prune = pruneWebuiMatches(() => false, 100, 1000)
    await hold.reached
    const forget = saveWebuiMatches({ [A]: null })
    // The forget goes as far as it can while the prune's store is held.
    await vi.runAllTimersAsync()
    hold.release()
    await expect(prune).resolves.toEqual({ [A]: { ...GUESS, missingSince: 1000 } })
    await expect(forget).resolves.toEqual({})
    expect(kept).toEqual({})
  })

  it('go on after one fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
    const failed = saveWebuiMatches({ [A]: USER })
    const next = saveWebuiMatches({ [B]: GUESS })
    await expect(failed).rejects.toMatchObject({ status: 502 })
    await expect(next).resolves.toEqual({ [B]: GUESS })
  })
})

describe('clearWebuiGuesses', () => {
  it('forgets every guess and miss, and keeps the user’s choices and other keys', async () => {
    kept = { [key(A)]: USER, [key(B)]: GUESS, [key(V2)]: MISS, 'other.ui': 1 }
    await expect(clearWebuiGuesses()).resolves.toEqual({ [A]: USER })
    expect(stored()).toEqual([{ [key(B)]: null, [key(V2)]: null }])
    expect(kept).toEqual({ [key(A)]: USER, 'other.ui': 1 })
  })
})

describe('pruneWebuiMatches', () => {
  it('notes the torrents qBittorrent no longer has, and forgets their matches after the grace period', async () => {
    kept = { [key(A)]: USER, [key(B)]: GUESS }
    await expect(pruneWebuiMatches((hash) => hash === A, 100, 1000)).resolves.toEqual({ [A]: USER, [B]: { ...GUESS, missingSince: 1000 } })
    expect(stored()).toEqual([{ [key(B)]: { ...GUESS, missingSince: 1000 } }])
    await expect(pruneWebuiMatches((hash) => hash === A, 100, 1100)).resolves.toEqual({ [A]: USER })
    expect(kept).toEqual({ [key(A)]: USER })
  })

  it('stores nothing when every torrent is still there', async () => {
    kept = { [key(A)]: USER }
    await pruneWebuiMatches(() => true, 100, 1000)
    expect(stored()).toEqual([])
  })
})

describe('the matches client in the WebUI build', () => {
  it('keeps the matches in qBittorrent, not on a Kinopeer server', async () => {
    kept = { [key(A)]: USER, [key(B)]: GUESS }
    await expect(getMatches()).resolves.toEqual({ [A]: USER, [B]: GUESS })
    await expect(saveMatches({ [V2]: MISS })).resolves.toEqual({ [A]: USER, [B]: GUESS, [V2]: MISS })
    await expect(clearGuesses()).resolves.toEqual({ [A]: USER })
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('api/v2/clientdata/'))).toBe(true)
  })
})
