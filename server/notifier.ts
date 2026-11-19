/**
 * The server's watcher of finished downloads. A torrent whose notification is on carries
 * qBittorrent's tag NOTIFY_TAG, which works as "notify once": every NOTIFY_INTERVAL_MS the server
 * asks qBittorrent for the torrents with that tag (`torrents/info?tag=`, through the bridge with
 * the server's session, never `sync/maindata`, whose `rid` the browsers' poll holds), sends each
 * finished one through every channel that's set up, then takes the tag off. Nothing is kept on
 * disk: a torrent that finished while Kinopeer was down still has its tag and is notified on the
 * first pass, and one that's checked and finishes again has no tag left, so it isn't notified twice.
 *
 * With no channel set up it asks qBittorrent nothing. A channel that refuses a message for good
 * (`rejected`) is done with it; one that doesn't answer is asked again after RETRY_DELAYS_MS, or
 * after the wait it asked for, and the tag stays until every channel is done.
 */

/** The tag that switches a torrent's notification on; Kinopeer's client adds and removes it too. */
export const NOTIFY_TAG = 'kinopeer:notify'

export const NOTIFY_INTERVAL_MS = 30_000

/** How long to wait before sending again through a channel that didn't answer: 30 s, 2 min, then every 10 min. */
export const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000] as const

/** What the watcher reads of a torrent. */
export interface NotifyTorrent {
  hash: string
  name: string
  tags: string
  progress: number
  state: string
}

/**
 * A way to send a notification: Telegram, and later Web Push. `send` resolves `sent`, or `rejected`
 * when the channel refused it for good; it rejects when the channel didn't answer, with
 * `retryAfterMs` on the error when the channel said how long to wait.
 */
export interface NotifyChannel {
  /** A name of its own among the channels, for the log. */
  id: string
  /** Whether it's set up to send. */
  ready: () => boolean
  send: (torrent: NotifyTorrent) => Promise<'sent' | 'rejected'>
}

/**
 * The states of a torrent whose wanted files are all there: seeding, or stopped, queued or stalled
 * after it. Checking, moving and an error don't count, even at 100 %.
 */
const FINISHED_STATES = new Set(['uploading', 'stalledUP', 'queuedUP', 'forcedUP', 'pausedUP', 'stoppedUP'])

export function isFinished(torrent: Pick<NotifyTorrent, 'progress' | 'state'>): boolean {
  return torrent.progress >= 1 && FINISHED_STATES.has(torrent.state)
}

export interface NotifierDeps {
  channels: NotifyChannel[]
  /** The torrents with NOTIFY_TAG, or undefined when qBittorrent didn't answer with them. */
  tagged: () => Promise<NotifyTorrent[] | undefined>
  /** Takes NOTIFY_TAG off these torrents; rejects when qBittorrent didn't. */
  untag: (hashes: string[]) => Promise<void>
  now?: () => number
  log?: (message: string) => void
}

interface Delivery {
  done: boolean
  attempts: number
  /** Not sent again before then. */
  nextAt: number
}

function retryAfter(error: unknown): number {
  const ms = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs
  return typeof ms === 'number' && ms > 0 ? ms : 0
}

/** One pass of the watcher, `check`, run by `startNotifier`; apart for the tests. */
export function createNotifier(deps: NotifierDeps): { check: () => Promise<void> } {
  const now = deps.now ?? Date.now
  const log = deps.log ?? ((message: string) => console.warn(`[kinopeer] ${message}`))
  // Per torrent, per channel: what's been sent, so a channel that answered isn't asked again while
  // another is retried, or while the tag couldn't be taken off yet.
  const deliveries = new Map<string, Map<string, Delivery>>()
  let running = false

  const deliver = async (torrent: NotifyTorrent, channel: NotifyChannel, sent: Map<string, Delivery>) => {
    const delivery = sent.get(channel.id) ?? { done: false, attempts: 0, nextAt: 0 }
    sent.set(channel.id, delivery)
    if (delivery.done || now() < delivery.nextAt) return
    try {
      const result = await channel.send(torrent)
      delivery.done = true
      if (result === 'rejected') log(`${channel.id} refused the notification for a finished download`)
    } catch (error) {
      delivery.attempts += 1
      const wait = RETRY_DELAYS_MS[Math.min(delivery.attempts, RETRY_DELAYS_MS.length) - 1]
      delivery.nextAt = now() + Math.max(wait, retryAfter(error))
      log(`${channel.id} didn't answer; sending again in ${Math.round((delivery.nextAt - now()) / 1000)} s`)
    }
  }

  const pass = async () => {
    const ready = deps.channels.filter((channel) => channel.ready())
    if (ready.length === 0) return
    const torrents = await deps.tagged()
    if (!torrents) return
    const present = new Set(torrents.map((torrent) => torrent.hash))
    // A torrent whose tag was taken off elsewhere, or that was deleted, is forgotten.
    for (const hash of deliveries.keys()) if (!present.has(hash)) deliveries.delete(hash)

    const notified: string[] = []
    for (const torrent of torrents.filter(isFinished)) {
      const sent = deliveries.get(torrent.hash) ?? new Map<string, Delivery>()
      deliveries.set(torrent.hash, sent)
      for (const channel of ready) await deliver(torrent, channel, sent)
      if (ready.every((channel) => sent.get(channel.id)?.done)) notified.push(torrent.hash)
    }
    if (notified.length === 0) return
    try {
      await deps.untag(notified)
      for (const hash of notified) deliveries.delete(hash)
    } catch {
      // Sent, and remembered as sent: the next pass takes the tag off without sending again.
      log(`couldn't take the ${NOTIFY_TAG} tag off; trying again on the next pass`)
    }
  }

  return {
    check: async () => {
      if (running) return
      running = true
      try {
        await pass()
      } catch {
        // qBittorrent unreachable: the next pass asks again.
      } finally {
        running = false
      }
    },
  }
}

/** Runs the watcher every `intervalMs`; returns a function that stops it. */
export function startNotifier(deps: NotifierDeps, intervalMs = NOTIFY_INTERVAL_MS): () => void {
  const { check } = createNotifier(deps)
  const timer = setInterval(() => void check(), intervalMs)
  // Never keeps the process alive on its own (tests, `vite build`).
  timer.unref()
  return () => clearInterval(timer)
}

type Get = (path: string) => Promise<Response>
type Post = (path: string, form: URLSearchParams) => Promise<Response>

/** The torrents with NOTIFY_TAG through the bridge's `get`, or undefined when qBittorrent didn't answer with a list. */
export async function taggedTorrents(get: Get): Promise<NotifyTorrent[] | undefined> {
  const response = await get(`/api/v2/torrents/info?${new URLSearchParams({ tag: NOTIFY_TAG })}`)
  if (!response.ok) return undefined
  const torrents: unknown = await response.json()
  if (!Array.isArray(torrents)) return undefined
  return torrents.flatMap((torrent: unknown) => {
    const { hash, name, tags, progress, state } = (torrent ?? {}) as Partial<Record<keyof NotifyTorrent, unknown>>
    return typeof hash === 'string' && typeof progress === 'number' && typeof state === 'string'
      ? [{ hash, name: typeof name === 'string' ? name : hash, tags: typeof tags === 'string' ? tags : '', progress, state }]
      : []
  })
}

/** Takes NOTIFY_TAG off `hashes` through the bridge's `post`; rejects when qBittorrent didn't. */
export async function removeNotifyTag(post: Post, hashes: string[]): Promise<void> {
  const response = await post('/api/v2/torrents/removeTags', new URLSearchParams({ hashes: hashes.join('|'), tags: NOTIFY_TAG }))
  if (!response.ok) throw new Error(`qBittorrent answered ${response.status}`)
}
