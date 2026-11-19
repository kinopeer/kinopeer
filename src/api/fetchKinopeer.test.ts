import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { opaqueRedirect } from '../test/fixtures'
import { setSignInNeed, signInNeed } from './auth/signInNeed'
import { AUTH_HEADER, ProxySignInError, SignInRequiredError, fetchKinopeer, onProxySignIn } from './fetchKinopeer'

let fetchMock: Mock<typeof fetch>
const proxy = { signIn: vi.fn<() => void>(), answered: vi.fn<() => void>() }

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  onProxySignIn(proxy)
})

afterEach(() => {
  onProxySignIn({ signIn: () => {}, answered: () => {} })
})

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
  })

  it('takes a redirect for a sign-in proxy: signs in through it and fails the request', async () => {
    fetchMock.mockResolvedValueOnce(opaqueRedirect())
    await expect(fetchKinopeer('/qbt/api/v2/app/version')).rejects.toBeInstanceOf(ProxySignInError)
    expect(proxy.signIn).toHaveBeenCalledOnce()
    expect(proxy.answered).not.toHaveBeenCalled()
  })

  it('passes any other answer on, an error included, and says one came', async () => {
    fetchMock.mockResolvedValueOnce(new Response('qBittorrent is unreachable', { status: 502 }))
    const response = await fetchKinopeer('/qbt/api/v2/app/version')
    expect(response.status).toBe(502)
    expect(proxy.answered).toHaveBeenCalledOnce()
    expect(proxy.signIn).not.toHaveBeenCalled()
  })
})

describe('fetchKinopeer and Kinopeer’s own login', () => {
  afterEach(() => {
    setSignInNeed(null)
  })

  it.each(['sign-in', 'set-up'] as const)('fails a request the login holds back and says the page needs to %s', async (need) => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401, headers: { [AUTH_HEADER]: need } }))
    await expect(fetchKinopeer('/qbt/api/v2/app/version')).rejects.toEqual(new SignInRequiredError(need))
    expect(signInNeed()).toBe(need)
  })

  it('passes on a 401 that isn’t the login’s, as qBittorrent’s', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
    expect((await fetchKinopeer('/qbt/api/v2/app/version')).status).toBe(401)
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401, headers: { [AUTH_HEADER]: 'something else' } }))
    expect((await fetchKinopeer('/qbt/api/v2/app/version')).status).toBe(401)
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403, headers: { [AUTH_HEADER]: 'sign-in' } }))
    expect((await fetchKinopeer('/qbt/api/v2/app/version')).status).toBe(403)
    expect(signInNeed()).toBeNull()
  })
})
