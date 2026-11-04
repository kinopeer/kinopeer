import type { MainData, ServerState, Torrent } from '../api/qbittorrent'

/** Client-side copy of qBittorrent's state, kept current by applying /sync/maindata deltas. */
export interface SyncState {
  rid: number
  torrents: Record<string, Torrent>
  server: Partial<ServerState>
}

export const EMPTY_SYNC_STATE: SyncState = { rid: 0, torrents: {}, server: {} }

/**
 * `Torrent`'s fields, which are all the app reads of a torrent: the poll keeps only these
 * (`applyMainData`), so a torrent whose other fields changed (qBittorrent reports `time_active`,
 * `seeding_time`, `reannounce` and `popularity` for most running torrents on each poll) keeps its
 * object and its rows don't render again. A field added to `Torrent` has to be added here, or the
 * check below fails to compile.
 */
const TORRENT_FIELDS = [
  'hash',
  'name',
  'state',
  'progress',
  'size',
  'total_size',
  'downloaded',
  'uploaded',
  'amount_left',
  'dlspeed',
  'upspeed',
  'dl_limit',
  'up_limit',
  'eta',
  'ratio',
  'num_seeds',
  'num_leechs',
  'num_complete',
  'num_incomplete',
  'category',
  'tags',
  'save_path',
  'content_path',
  'added_on',
  'completion_on',
  'priority',
] as const satisfies readonly (keyof Torrent)[]

// Every field of `Torrent` is in the list: an unlisted one would never reach the app from the poll.
const everyFieldListed: [Exclude<keyof Torrent, (typeof TORRENT_FIELDS)[number]>] extends [never] ? true : never = true
void everyFieldListed

const READ_FIELDS: ReadonlySet<string> = new Set(TORRENT_FIELDS)

/**
 * The torrent with qBittorrent's changes, keeping only the fields the app reads (`TORRENT_FIELDS`).
 * Its object stays the same unless one of those changed, so what renders a torrent can skip it when
 * only fields the app doesn't read changed.
 */
function mergeTorrent(hash: string, previous: Torrent | undefined, changes: object): Torrent {
  let next: Record<string, unknown> | undefined
  for (const [field, value] of Object.entries(changes)) {
    if (!READ_FIELDS.has(field) || (previous && previous[field as keyof Torrent] === value)) continue
    next ??= { ...previous, hash }
    next[field] = value
  }
  return (next as Torrent | undefined) ?? previous ?? ({ hash } as Torrent)
}

export function applyMainData(state: SyncState, data: MainData): SyncState {
  const torrents: Record<string, Torrent> = data.full_update ? {} : { ...state.torrents }
  for (const [hash, changes] of Object.entries(data.torrents ?? {})) {
    torrents[hash] = mergeTorrent(hash, torrents[hash], changes)
  }
  for (const hash of data.torrents_removed ?? []) delete torrents[hash]

  return {
    rid: data.rid,
    torrents,
    server: data.full_update ? { ...data.server_state } : { ...state.server, ...data.server_state },
  }
}
