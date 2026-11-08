import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { opaqueRedirect } from '../test/fixtures'
import { ProxySignInError, fetchKinopeer, onProxySignIn } from './fetchKinopeer'

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
