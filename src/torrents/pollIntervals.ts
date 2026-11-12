// How often the app polls qBittorrent. A module of its own that imports nothing, so the requests
// test (e2e/performance/) reads the same numbers by its path: it lets the clock run for less than
// the shortest of them, so a screen's open is counted without a poll repeating
// (docs/QUALITY.md → The requests budget). A new poll's interval goes here too.

/** The torrents' poll, `sync/maindata`. */
export const POLL_INTERVAL_MS = 2_000
/** Slower retries of that poll while qBittorrent doesn't answer. */
export const OFFLINE_POLL_INTERVAL_MS = 5_000
/** A torrent's files, while its Files section is open. */
export const FILES_POLL_INTERVAL_MS = 3_000
