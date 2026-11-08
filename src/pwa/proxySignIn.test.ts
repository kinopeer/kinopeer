import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ProxySignInError, fetchKinopeer, onProxySignIn } from '../api/fetchKinopeer'
import { SIGN_IN_RETRY_MS, signInThroughProxy, startProxySignIn } from './proxySignIn'

const navigation = (href: string) => ({ href, replace: vi.fn<(url: string) => void>() })

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  onProxySignIn(() => {})
  window.history.replaceState(null, '', '/')
})

describe('signInThroughProxy', () => {
  it('loads the screen it is on again with the sign-in parameter, in place of the current entry', () => {
    const location = navigation('https://umbrel.local:8798/search?q=dune&type=movie#top')
    signInThroughProxy(location, 1_000_000)
    expect(location.replace).toHaveBeenCalledExactlyOnceWith('https://umbrel.local:8798/search?q=dune&type=movie&proxy-sign-in=1#top')
  })

  it('tries again only once SIGN_IN_RETRY_MS has passed, so a proxy whose cookie does not stick does not loop', () => {
    const first = navigation('https://umbrel.local:8798/')
    signInThroughProxy(first, 1_000_000)
    const soon = navigation('https://umbrel.local:8798/')
    signInThroughProxy(soon, 1_000_000 + SIGN_IN_RETRY_MS - 1)
    const later = navigation('https://umbrel.local:8798/')
    signInThroughProxy(later, 1_000_000 + SIGN_IN_RETRY_MS)
    expect(first.replace).toHaveBeenCalledOnce()
    expect(soon.replace).not.toHaveBeenCalled()
    expect(later.replace).toHaveBeenCalledOnce()
  })

  it('stays put without session storage, which is what stops a loop', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    const location = navigation('https://umbrel.local:8798/')
    signInThroughProxy(location, 1_000_000)
    expect(location.replace).not.toHaveBeenCalled()
  })
})

describe('startProxySignIn', () => {
  it('takes the parameter out of the address the proxy sent the app back to, keeping the rest and the history state', () => {
    window.history.replaceState({ key: 'abc' }, '', '/title/movie/1?tab=cast&proxy-sign-in=1#crew')
    startProxySignIn(navigation('https://umbrel.local:8798/'))
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/title/movie/1?tab=cast#crew')
    expect(window.history.state).toEqual({ key: 'abc' })
  })

  it('leaves an address without the parameter alone', () => {
    window.history.replaceState(null, '', '/search?q=dune')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    startProxySignIn(navigation('https://umbrel.local:8798/'))
    expect(replaceState).not.toHaveBeenCalled()
    expect(`${window.location.pathname}${window.location.search}`).toBe('/search?q=dune')
  })

  it('loads the page through the proxy when a request comes back redirected', async () => {
    const fetchMock: Mock<typeof fetch> = vi.fn<typeof fetch>()
    // What fetch answers for a redirect with redirect: 'manual'; jsdom can't build one.
    fetchMock.mockResolvedValue({ type: 'opaqueredirect', status: 0, ok: false } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const location = navigation('https://umbrel.local:8798/torrent/abc')
    startProxySignIn(location)
    await expect(fetchKinopeer('/qbt/api/v2/app/version')).rejects.toBeInstanceOf(ProxySignInError)
    expect(location.replace).toHaveBeenCalledExactlyOnceWith('https://umbrel.local:8798/torrent/abc?proxy-sign-in=1')
  })
})
