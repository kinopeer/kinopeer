import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NOTIFY_TAG,
  RETRY_DELAYS_MS,
  createNotifier,
  isFinished,
  removeNotifyTag,
  startNotifier,
  taggedTorrents,
  type NotifierDeps,
  type NotifyChannel,
  type NotifyTorrent,
} from './notifier.ts'

afterEach(() => {
  vi.useRealTimers()
})

const torrent = (hash: string, overrides: Partial<NotifyTorrent> = {}): NotifyTorrent => ({
  hash,
  name: `Torrent ${hash}`,
  tags: NOTIFY_TAG,
  progress: 1,
  state: 'stalledUP',
  ...overrides,
})

/** A channel whose `send` answers what `answers` gives it, call by call, and records what it got. */
function channel(id: string, answers: (() => Promise<'sent' | 'rejected'>)[] = [], ready = () => true) {
  const sent: string[] = []
  const fallback = async () => 'sent' as const
  const notify: NotifyChannel = {
    id,
    ready,
    send: vi.fn(async (finished: NotifyTorrent) => {
      sent.push(finished.hash)
      return (answers.shift() ?? fallback)()
    }),
  }
  return { notify, sent }
}

function notifier(overrides: Partial<NotifierDeps> & { torrents?: () => NotifyTorrent[] | undefined }) {
  const untagged: string[][] = []
  let clock = 0
  const deps: NotifierDeps = {
    channels: [],
    tagged: vi.fn(async () => overrides.torrents?.()),
    untag: vi.fn(async (hashes: string[]) => void untagged.push(hashes)),
    now: () => clock,
    log: vi.fn(),
    ...overrides,
  }
  return { ...createNotifier(deps), deps, untagged, advance: (ms: number) => (clock += ms) }
}

describe('isFinished', () => {
  it.each([
    ['seeding', 'uploading', 1, true],
    ['stalled after finishing', 'stalledUP', 1, true],
    ['queued for seeding', 'queuedUP', 1, true],
    ['forced seeding', 'forcedUP', 1, true],
    ['stopped after finishing (qBittorrent 5)', 'stoppedUP', 1, true],
    ['paused after finishing (qBittorrent 4)', 'pausedUP', 1, true],
    ['still downloading', 'downloading', 0.5, false],
    ['being checked at 100 %', 'checkingUP', 1, false],
    ['being moved at 100 %', 'moving', 1, false],
    ['in error at 100 %', 'error', 1, false],
    ['missing its files', 'missingFiles', 1, false],
    ['a seeding state below 100 %, as qBittorrent reports for a moment', 'stalledUP', 0.99, false],
  ])('%s: %s at %s is %s', (_name, state, progress, finished) => {
    expect(isFinished({ state, progress })).toBe(finished)
  })
})

describe('createNotifier', () => {
  it('asks qBittorrent nothing while no channel is set up', async () => {
    const telegram = channel('Telegram', [], () => false)
    const watcher = notifier({ channels: [telegram.notify], torrents: () => [torrent('a')] })
    await watcher.check()
    expect(watcher.deps.tagged).not.toHaveBeenCalled()
  })

  it('sends each finished tagged torrent through every ready channel, then takes the tag off', async () => {
    const telegram = channel('Telegram')
    const push = channel('Push')
    const off = channel('Off', [], () => false)
    const watcher = notifier({
      channels: [telegram.notify, push.notify, off.notify],
      torrents: () => [torrent('a'), torrent('b', { progress: 0.4, state: 'downloading' }), torrent('c', { state: 'pausedUP' })],
    })
    await watcher.check()
    expect(telegram.sent).toEqual(['a', 'c'])
    expect(push.sent).toEqual(['a', 'c'])
    expect(off.sent).toEqual([])
    expect(watcher.untagged).toEqual([['a', 'c']])
    expect(watcher.deps.log).not.toHaveBeenCalled()
  })

  it('keeps the tag on a torrent a channel stopped being set up for during the pass, and sends it once set up again', async () => {
    let setUp = true
    const telegram = channel('Telegram', [], () => setUp)
    // Turned off (or set to another bot) while the first message was on its way.
    vi.mocked(telegram.notify.send).mockImplementationOnce(async (finished) => {
      telegram.sent.push(finished.hash)
      setUp = false
      return 'sent'
    })
    const watcher = notifier({
      channels: [telegram.notify],
      torrents: () => [torrent('a'), torrent('b')].filter((tagged) => !watcher.untagged.flat().includes(tagged.hash)),
    })
    await watcher.check()
    expect(telegram.sent).toEqual(['a'])
    expect(watcher.untagged).toEqual([['a']])
    expect(watcher.deps.log).not.toHaveBeenCalled()
    setUp = true
    await watcher.check()
    expect(telegram.sent).toEqual(['a', 'b'])
    expect(watcher.untagged).toEqual([['a'], ['b']])
  })

  it('notifies again about a torrent tagged again after it was notified', async () => {
    const telegram = channel('Telegram')
    // qBittorrent keeps the tag on the first pass's answer: switched on again on the torrent's page.
    const watcher = notifier({ channels: [telegram.notify], torrents: () => [torrent('a')] })
    await watcher.check()
    await watcher.check()
    expect(telegram.sent).toEqual(['a', 'a'])
  })

  it('says in the log, by default the server’s, when a channel refused or didn’t answer, and when to send again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const telegram = channel('Telegram', [async () => 'rejected'])
    await createNotifier({ channels: [telegram.notify], tagged: async () => [torrent('a')], untag: async () => {} }).check()
    expect(warn).toHaveBeenCalledWith('[kinopeer] Telegram refused the notification for a finished download')

    const log = vi.fn()
    const down = channel('Telegram', [() => Promise.reject(new Error('no answer'))])
    const watcher = notifier({ channels: [down.notify], torrents: () => [torrent('a')], log })
    // Some time into the server's life, so the wait isn't read from the clock's start.
    watcher.advance(5 * 60_000)
    await watcher.check()
    expect(log).toHaveBeenCalledWith("Telegram didn't answer; sending again in 30 s")
  })

  it('sends nothing again on the next pass once the tag is off', async () => {
    const telegram = channel('Telegram')
    let tagged = [torrent('a')]
    const watcher = notifier({ channels: [telegram.notify], torrents: () => tagged, untag: async () => void (tagged = []) })
    await watcher.check()
    await watcher.check()
    expect(telegram.sent).toEqual(['a'])
  })

  it('takes the tag off a torrent a channel refused for good, without sending again', async () => {
    const telegram = channel('Telegram', [async () => 'rejected'])
    const log = vi.fn()
    const watcher = notifier({ channels: [telegram.notify], torrents: () => [torrent('a')], log })
    await watcher.check()
    expect(watcher.untagged).toEqual([['a']])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('refused'))
  })

  it('keeps the tag while a channel doesn’t answer, and sends again only after the wait', async () => {
    const down = () => Promise.reject(new Error('no answer'))
    const telegram = channel('Telegram', [down, down, down, down])
    const watcher = notifier({ channels: [telegram.notify], torrents: () => [torrent('a')] })

    await watcher.check()
    expect(telegram.sent).toHaveLength(1)
    expect(watcher.untagged).toEqual([])

    // Each wait is longer than the one before, and nothing goes out before it's over.
    for (const wait of RETRY_DELAYS_MS) {
      const before = telegram.sent.length
      watcher.advance(wait - 1)
      await watcher.check()
      expect(telegram.sent).toHaveLength(before)
      watcher.advance(1)
      await watcher.check()
      expect(telegram.sent).toHaveLength(before + 1)
    }
    // Then every 10 minutes.
    watcher.advance(RETRY_DELAYS_MS[2])
    await watcher.check()
    expect(telegram.sent).toHaveLength(5)
    expect(watcher.untagged).toEqual([['a']])
  })

  it.each(['90000', Number.NaN, -90_000])('waits its own time when the channel asked for a wait it can’t read: %s', async (retryAfterMs) => {
    const telegram = channel('Telegram', [() => Promise.reject(Object.assign(new Error('429'), { retryAfterMs }))])
    const watcher = notifier({ channels: [telegram.notify], torrents: () => [torrent('a')] })
    await watcher.check()
    watcher.advance(RETRY_DELAYS_MS[0] - 1)
    await watcher.check()
    expect(telegram.sent).toHaveLength(1)
    watcher.advance(1)
    await watcher.check()
    expect(telegram.sent).toHaveLength(2)
  })

  it('counts the wait from the pass’s start, so the pass a wait later sends again however long the send took', async () => {
    let watcher!: ReturnType<typeof notifier>
    const slowFailure = async (): Promise<'sent'> => {
      watcher.advance(5_000)
      throw new Error('no answer')
    }
    const telegram = channel('Telegram', [slowFailure])
    watcher = notifier({ channels: [telegram.notify], torrents: () => [torrent('a')] })
    await watcher.check()
    watcher.advance(RETRY_DELAYS_MS[0] - 5_000)
    await watcher.check()
    expect(telegram.sent).toHaveLength(2)
  })

  it('waits as long as the channel asked when that’s longer', async () => {
    const telegram = channel('Telegram', [() => Promise.reject(Object.assign(new Error('429'), { retryAfterMs: 90_000 }))])
    const watcher = notifier({ channels: [telegram.notify], torrents: () => [torrent('a')] })
    await watcher.check()
    watcher.advance(89_999)
    await watcher.check()
    expect(telegram.sent).toHaveLength(1)
    watcher.advance(1)
    await watcher.check()
    expect(telegram.sent).toHaveLength(2)
  })

  it('counts a wait the channel asked for from its answer, late in a long pass, and says so in the log', async () => {
    let watcher!: ReturnType<typeof notifier>
    const lateRefusal = async (): Promise<'sent'> => {
      watcher.advance(15_000)
      throw Object.assign(new Error('429'), { retryAfterMs: 60_000 })
    }
    const telegram = channel('Telegram', [lateRefusal])
    watcher = notifier({ channels: [telegram.notify], torrents: () => [torrent('a')] })
    await watcher.check()
    expect(watcher.deps.log).toHaveBeenCalledWith("Telegram didn't answer; sending again in 60 s")
    watcher.advance(60_000 - 1)
    await watcher.check()
    expect(telegram.sent).toHaveLength(1)
    watcher.advance(1)
    await watcher.check()
    expect(telegram.sent).toHaveLength(2)
  })

  it('doesn’t send again through a channel that answered while another is retried', async () => {
    const telegram = channel('Telegram')
    const push = channel('Push', [() => Promise.reject(new Error('no answer'))])
    const watcher = notifier({ channels: [telegram.notify, push.notify], torrents: () => [torrent('a')] })
    await watcher.check()
    watcher.advance(RETRY_DELAYS_MS[0])
    await watcher.check()
    expect(telegram.sent).toEqual(['a'])
    expect(push.sent).toEqual(['a', 'a'])
    expect(watcher.untagged).toEqual([['a']])
  })

  it('takes the tag off on the next pass, without sending again, when qBittorrent didn’t take it off', async () => {
    const telegram = channel('Telegram')
    const untag = vi.fn().mockRejectedValueOnce(new Error('qBittorrent')).mockResolvedValueOnce(undefined)
    const log = vi.fn()
    const watcher = notifier({ channels: [telegram.notify], torrents: () => [torrent('a')], untag, log })
    await watcher.check()
    expect(log).toHaveBeenCalledWith("couldn't take the kinopeer:notify tag off; trying again on the next pass")
    await watcher.check()
    expect(telegram.sent).toEqual(['a'])
    expect(untag).toHaveBeenCalledTimes(2)
  })

  it('forgets a torrent that lost its tag elsewhere, so tagged again it’s notified again', async () => {
    const push = channel('Push', [() => Promise.reject(new Error('no answer'))])
    let tagged = [torrent('a')]
    const watcher = notifier({ channels: [push.notify], torrents: () => tagged })
    await watcher.check()
    tagged = []
    await watcher.check()
    tagged = [torrent('a')]
    await watcher.check()
    expect(push.sent).toEqual(['a', 'a'])
  })

  it('does nothing when qBittorrent doesn’t answer, or answers that it can’t', async () => {
    const telegram = channel('Telegram')
    const unreachable = notifier({ channels: [telegram.notify], tagged: () => Promise.reject(new Error('down')) })
    await expect(unreachable.check()).resolves.toBeUndefined()
    const refused = notifier({ channels: [telegram.notify], torrents: () => undefined })
    await refused.check()
    expect(telegram.sent).toEqual([])
  })

  it('runs one pass at a time', async () => {
    let answer!: (torrents: NotifyTorrent[]) => void
    const tagged = vi.fn(() => new Promise<NotifyTorrent[]>((resolve) => (answer = resolve)))
    const watcher = notifier({ channels: [channel('Telegram').notify], tagged })
    const first = watcher.check()
    await watcher.check()
    answer([])
    await first
    expect(tagged).toHaveBeenCalledTimes(1)
  })
})

describe('startNotifier', () => {
  it('checks every interval until stopped', async () => {
    vi.useFakeTimers()
    const tagged = vi.fn(async () => [])
    const stop = startNotifier({ channels: [channel('Telegram').notify], tagged, untag: async () => {} }, 1000)
    await vi.advanceTimersByTimeAsync(999)
    expect(tagged).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(tagged).toHaveBeenCalledTimes(1)
    stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(tagged).toHaveBeenCalledTimes(1)
  })

  it('never keeps the server’s process alive on its own', () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    const stop = startNotifier({ channels: [], tagged: async () => [], untag: async () => {} }, 60_000)
    expect((interval.mock.results[0].value as NodeJS.Timeout).hasRef()).toBe(false)
    stop()
  })
})

describe('taggedTorrents', () => {
  it('asks qBittorrent for the torrents with the tag and reads what the watcher needs', async () => {
    const get = vi.fn(async () =>
      Response.json([
        { hash: 'a', name: 'Dune', tags: 'kinopeer:notify, tmdb:movie:438631', progress: 1, state: 'uploading', size: 1 },
        { hash: 'b', progress: 0.2, state: 'downloading' },
        { name: 'no hash', progress: 1, state: 'uploading' },
        { hash: 'c', progress: '1', state: 'uploading' },
        { hash: 'd', progress: 1 },
        null,
      ]),
    )
    expect(await taggedTorrents(get)).toEqual([
      { hash: 'a', name: 'Dune', tags: 'kinopeer:notify, tmdb:movie:438631', progress: 1, state: 'uploading' },
      { hash: 'b', name: 'b', tags: '', progress: 0.2, state: 'downloading' },
    ])
    expect(get).toHaveBeenCalledWith('/api/v2/torrents/info?tag=kinopeer%3Anotify')
  })

  it('answers undefined when qBittorrent refuses, or answers with something else than a list', async () => {
    expect(await taggedTorrents(async () => new Response('Forbidden', { status: 403 }))).toBeUndefined()
    expect(await taggedTorrents(async () => Response.json({ torrents: [] }))).toBeUndefined()
  })
})

describe('removeNotifyTag', () => {
  it('takes the tag off the torrents in one request', async () => {
    const post = vi.fn(async () => new Response(''))
    await removeNotifyTag(post, ['a', 'b'])
    expect(post).toHaveBeenCalledWith('/api/v2/torrents/removeTags', new URLSearchParams({ hashes: 'a|b', tags: 'kinopeer:notify' }))
  })

  it('rejects when qBittorrent refuses', async () => {
    await expect(removeNotifyTag(async () => new Response('', { status: 403 }), ['a'])).rejects.toThrow()
  })
})
