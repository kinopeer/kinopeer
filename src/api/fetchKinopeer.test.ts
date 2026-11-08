import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ProxySignInError, fetchKinopeer, onProxySignIn } from './fetchKinopeer'

let fetchMock: Mock<typeof fetch>
let signIn: Mock<() => void>

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  signIn = vi.fn()
  onProxySignIn(signIn)
})

afterEach(() => {
  vi.unstubAllGlobals()
  onProxySignIn(() => {})
})

/** What fetch answers for a redirect with redirect: 'manual'; jsdom can't build one. */
const opaqueRedirect = () => ({ type: 'opaqueredirect', status: 0, ok: false }) as Response

describe('fetchKinopeer', () => {
  it('sends the cookies, does not follow redirects and keeps the rest of the request', async () => {
    const answer = new Response('{}')
    fetchMock.mockResolvedValueOnce(answer)
    const signal = new AbortController().signal
    await expect(fetchKinopeer('/api/matches', { method: 'PATCH', body: '{}', signal })).resolves.toBe(answer)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/matches', {
      method: 'PATCH',
      body: '{}',
      signal,
      credentials: 'same-origin',
      redirect: 'manual',
    })
    expect(signIn).not.toHaveBeenCalled()
  })

  it('takes a redirect for a sign-in proxy: signs in through it and fails the request', async () => {
    fetchMock.mockResolvedValueOnce(opaqueRedirect())
    await expect(fetchKinopeer('/qbt/api/v2/app/version')).rejects.toBeInstanceOf(ProxySignInError)
    expect(signIn).toHaveBeenCalledOnce()
  })

  it('passes an error answer on, which the clients read themselves', async () => {
    fetchMock.mockResolvedValueOnce(new Response('qBittorrent is unreachable', { status: 502 }))
    const response = await fetchKinopeer('/qbt/api/v2/app/version')
    expect(response.status).toBe(502)
    expect(signIn).not.toHaveBeenCalled()
  })
})
