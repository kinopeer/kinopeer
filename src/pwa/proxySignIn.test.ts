import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProxySignInError, fetchKinopeer, onProxySignIn } from '../api/fetchKinopeer'
import { opaqueRedirect } from '../test/fixtures'
import { SIGN_IN_RETRY_MS, loadPastTheShell, signInThroughProxy, startProxySignIn } from './proxySignIn'

const navigation = (href: string) => ({ href, replace: vi.fn<(url: string) => void>() })

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  onProxySignIn({ signIn: () => {}, answered: () => {} })
  window.history.replaceState(null, '', '/')
})

describe('signInThroughProxy', () => {
  it('loads the screen it is on again with the sign-in parameter, in place of the current entry', () => {
    const location = navigation('https://umbrel.local:8798/search?q=dune&type=movie#top')
    signInThroughProxy(location, 1_000_000)
    expect(location.replace).toHaveBeenCalledExactlyOnceWith('https://umbrel.local:8798/search?q=dune&type=movie&proxy-sign-in=1#top')
  })

  it('tries again only once SIGN_IN_RETRY_MS has passed, so a sign-in closed without signing in does not reopen with every poll', () => {
    const first = navigation('https://umbrel.local:8798/')
    signInThroughProxy(first, 1_000_000)
    const sameMoment = navigation('https://umbrel.local:8798/')
    signInThroughProxy(sameMoment, 1_000_000)
    const soon = navigation('https://umbrel.local:8798/')
    signInThroughProxy(soon, 1_000_000 + SIGN_IN_RETRY_MS - 1)
    const later = navigation('https://umbrel.local:8798/')
    signInThroughProxy(later, 1_000_000 + SIGN_IN_RETRY_MS)
    expect(first.replace).toHaveBeenCalledOnce()
    expect(sameMoment.replace).not.toHaveBeenCalled()
    expect(soon.replace).not.toHaveBeenCalled()
    expect(later.replace).toHaveBeenCalledOnce()
  })

  it('takes a sign-in stamped later than now as stale, so a clock set back does not stop it', () => {
    signInThroughProxy(navigation('https://umbrel.local:8798/'), 1_000_000)
    const location = navigation('https://umbrel.local:8798/')
    signInThroughProxy(location, 1_000_000 - 1)
    expect(location.replace).toHaveBeenCalledOnce()
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

describe('loadPastTheShell', () => {
  it('loads the screen again with the parameter the service worker leaves to the network, at once after a sign-in too: the user asked', () => {
    signInThroughProxy(navigation('https://umbrel.local:8798/'), Date.now())
    const location = navigation('https://umbrel.local:8798/title/movie/1?tab=cast')
    loadPastTheShell(location)
    expect(location.replace).toHaveBeenCalledExactlyOnceWith('https://umbrel.local:8798/title/movie/1?tab=cast&proxy-sign-in=1')
  })
})

describe('startProxySignIn', () => {
  it('takes the parameter out of the address the proxy sent the app back to, keeping the rest and the history state', () => {
    window.history.replaceState({ key: 'abc' }, '', '/title/movie/1?tab=cast&proxy-sign-in=1#crew')
    startProxySignIn(navigation(window.location.href))
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/title/movie/1?tab=cast#crew')
    expect(window.history.state).toEqual({ key: 'abc' })
  })

  it('leaves an address without the parameter alone', () => {
    window.history.replaceState(null, '', '/search?q=dune')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    startProxySignIn(navigation(window.location.href))
    expect(replaceState).not.toHaveBeenCalled()
    expect(`${window.location.pathname}${window.location.search}`).toBe('/search?q=dune')
  })

  it('loads the page through the proxy when a request comes back redirected', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(opaqueRedirect()))
    const location = navigation('https://umbrel.local:8798/torrent/abc')
    startProxySignIn(location)
    await expect(fetchKinopeer('/qbt/api/v2/app/version')).rejects.toBeInstanceOf(ProxySignInError)
    expect(location.replace).toHaveBeenCalledExactlyOnceWith('https://umbrel.local:8798/torrent/abc?proxy-sign-in=1')
  })

  it('does not sign in again on the way back from a sign-in while every request is still redirected: the cookie did not stick', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(opaqueRedirect()))
    const location = navigation('https://umbrel.local:8798/torrent/abc?proxy-sign-in=1')
    startProxySignIn(location)
    await expect(fetchKinopeer('/qbt/api/v2/app/version')).rejects.toBeInstanceOf(ProxySignInError)
    expect(location.replace).not.toHaveBeenCalled()
  })

  it('signs in again once a request on the way back was answered, when a later one is redirected', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('v5.1.0')).mockResolvedValue(opaqueRedirect())
    vi.stubGlobal('fetch', fetchMock)
    const location = navigation('https://umbrel.local:8798/torrent/abc?proxy-sign-in=1')
    startProxySignIn(location)
    await fetchKinopeer('/qbt/api/v2/app/version')
    await expect(fetchKinopeer('/qbt/api/v2/sync/maindata')).rejects.toBeInstanceOf(ProxySignInError)
    expect(location.replace).toHaveBeenCalledExactlyOnceWith('https://umbrel.local:8798/torrent/abc?proxy-sign-in=1')
  })
})
