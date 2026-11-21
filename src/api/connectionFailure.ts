/**
 * Why Kinopeer's server got no answer from qBittorrent or Prowlarr (`connectionFailure` in
 * server/connectionFailure.ts), sent with an `unreachable` failure (#508): the name doesn't resolve,
 * nothing listens on the port, nothing answered in time, an https address on a plain HTTP port, a
 * certificate the server doesn't trust, or a connection closed with no answer.
 */
export const CONNECTION_FAILURES = ['name', 'refused', 'timeout', 'http', 'certificate', 'closed'] as const

export type ConnectionFailure = (typeof CONNECTION_FAILURES)[number]

/** The cause the server named, if it's one this app knows: a newer server may name others. */
export function knownFailure(value: unknown): ConnectionFailure | undefined {
  return CONNECTION_FAILURES.find((failure) => failure === value)
}

/** The cause an API client's error carries (`SettingsError`, `QbittorrentError`, `ProwlarrError`), if any. */
export function failureOf(error: unknown): ConnectionFailure | undefined {
  return error instanceof Error && 'failure' in error ? knownFailure(error.failure) : undefined
}
