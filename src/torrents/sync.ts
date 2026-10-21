import type { MainData, ServerState, Torrent } from '../api/qbittorrent'

/** Client-side copy of qBittorrent's state, kept current by applying /sync/maindata deltas. */
export interface SyncState {
  rid: number
  torrents: Record<string, Torrent>
  server: Partial<ServerState>
}

export const EMPTY_SYNC_STATE: SyncState = { rid: 0, torrents: {}, server: {} }

export function applyMainData(state: SyncState, data: MainData): SyncState {
  const torrents: Record<string, Torrent> = data.full_update ? {} : { ...state.torrents }
  for (const [hash, changes] of Object.entries(data.torrents ?? {})) {
    torrents[hash] = { ...torrents[hash], ...changes, hash } as Torrent
  }
  for (const hash of data.torrents_removed ?? []) delete torrents[hash]

  return {
    rid: data.rid,
    torrents,
    server: data.full_update ? { ...data.server_state } : { ...state.server, ...data.server_state },
  }
}
