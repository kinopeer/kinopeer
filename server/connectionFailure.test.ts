import { describe, expect, it } from 'vitest'
import { connectionFailure } from './connectionFailure.ts'

/** What `fetch` throws: a TypeError whose cause is the socket's, TLS's or undici's error. */
function fetchFailed(code: string | undefined, name = 'Error'): TypeError {
  const cause = Object.assign(new Error('failed'), { code })
  cause.name = name
  return new TypeError('fetch failed', { cause })
}

describe('connectionFailure', () => {
  it.each([
    ['ENOTFOUND', 'name'],
    ['EAI_AGAIN', 'name'],
    ['EAI_FAIL', 'name'],
    ['EAI_NODATA', 'name'],
    ['EAI_NONAME', 'name'],
    ['ECONNREFUSED', 'refused'],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
    ['UND_ERR_HEADERS_TIMEOUT', 'timeout'],
    ['ETIMEDOUT', 'timeout'],
    ['EHOSTUNREACH', 'timeout'],
    ['EHOSTDOWN', 'timeout'],
    ['ENETUNREACH', 'timeout'],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'http'],
    ['ERR_SSL_PACKET_LENGTH_TOO_LONG', 'http'],
    ['ERR_SSL_HTTP_REQUEST', 'http'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'certificate'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'certificate'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'certificate'],
    ['UNABLE_TO_GET_ISSUER_CERT', 'certificate'],
    ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'certificate'],
    ['CERT_HAS_EXPIRED', 'certificate'],
    ['CERT_NOT_YET_VALID', 'certificate'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'certificate'],
    ['ECONNRESET', 'closed'],
    ['EPIPE', 'closed'],
    ['UND_ERR_SOCKET', 'closed'],
  ])('names %s as %s', (code, failure) => {
    expect(connectionFailure(fetchFailed(code))).toBe(failure)
  })

  it('names an answer that isn’t HTTP as closed, which has no code', () => {
    expect(connectionFailure(fetchFailed(undefined, 'HTTPParserError'))).toBe('closed')
  })

  it('names the caller’s own time limit as a timeout', () => {
    expect(connectionFailure(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe('timeout')
  })

  it.each([
    ['another code', fetchFailed('ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION')],
    ['a code that isn’t a string', new TypeError('fetch failed', { cause: Object.assign(new Error('failed'), { code: 111 }) })],
    [
      'a code that only reads as one',
      new TypeError('fetch failed', { cause: Object.assign(new Error('failed'), { code: { toString: () => 'ECONNREFUSED' } }) }),
    ],
    ['a cause that isn’t an error', new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })],
    ['no cause', new TypeError('fetch failed')],
    ['the browser gone', new DOMException('This operation was aborted', 'AbortError')],
    ['a service’s error answer', new Error('Prowlarr answered 500')],
    ['a value that isn’t an error', 'ECONNREFUSED'],
    ['an object that isn’t an error', { name: 'TimeoutError' }],
    ['an inherited name', fetchFailed('constructor')],
  ])('names nothing for %s', (_, error) => {
    expect(connectionFailure(error)).toBeUndefined()
  })
})
