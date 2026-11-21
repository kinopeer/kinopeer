import type { ConnectionFailure } from '../src/api/connectionFailure.ts'

/**
 * Node's codes for each cause, the same on Linux and macOS (Node 22 and 24, measured for #508): the
 * system's for the name and the socket, undici's for its own time limits and a socket closed under
 * it, OpenSSL's for TLS.
 */
const BY_CODE: Record<string, ConnectionFailure> = {
  // getaddrinfo: no such name, or no answer from DNS for it.
  ENOTFOUND: 'name',
  EAI_AGAIN: 'name',
  EAI_FAIL: 'name',
  EAI_NODATA: 'name',
  EAI_NONAME: 'name',
  ECONNREFUSED: 'refused',
  // No answer to connect in undici's 10 seconds, or the network says the host can't be reached.
  UND_ERR_CONNECT_TIMEOUT: 'timeout',
  UND_ERR_HEADERS_TIMEOUT: 'timeout',
  ETIMEDOUT: 'timeout',
  EHOSTUNREACH: 'timeout',
  EHOSTDOWN: 'timeout',
  ENETUNREACH: 'timeout',
  // An https address on a port that answers in plain HTTP: what came back isn't a TLS record.
  ERR_SSL_WRONG_VERSION_NUMBER: 'http',
  ERR_SSL_PACKET_LENGTH_TOO_LONG: 'http',
  ERR_SSL_HTTP_REQUEST: 'http',
  // A certificate this server doesn't trust: self-signed, from an unknown authority, expired or for another name.
  DEPTH_ZERO_SELF_SIGNED_CERT: 'certificate',
  SELF_SIGNED_CERT_IN_CHAIN: 'certificate',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'certificate',
  UNABLE_TO_GET_ISSUER_CERT: 'certificate',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'certificate',
  CERT_HAS_EXPIRED: 'certificate',
  CERT_NOT_YET_VALID: 'certificate',
  ERR_TLS_CERT_ALTNAME_INVALID: 'certificate',
  // Closed with no answer: an http address on a TLS port among others, which can't be told apart.
  ECONNRESET: 'closed',
  EPIPE: 'closed',
  UND_ERR_SOCKET: 'closed',
}

/**
 * Why a request to qBittorrent or Prowlarr got no answer, from what `fetch` threw: its `cause`
 * carries the code, and a time limit of the caller's is a `TimeoutError` of its own. An answer that
 * isn't HTTP is `closed` too, since what to check is the same: the port. Undefined for anything
 * else, which the app says as before.
 */
export function connectionFailure(error: unknown): ConnectionFailure | undefined {
  if (!(error instanceof Error)) return undefined
  if (error.name === 'TimeoutError') return 'timeout'
  const cause = error.cause
  if (!(cause instanceof Error)) return undefined
  if (cause.name === 'HTTPParserError') return 'closed'
  const code = (cause as { code?: unknown }).code
  // Own codes only: `constructor` isn't one.
  return typeof code === 'string' && Object.hasOwn(BY_CODE, code) ? BY_CODE[code] : undefined
}
