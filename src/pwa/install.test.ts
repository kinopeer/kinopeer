import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getInstallMethod, listenForInstallPrompt, promptInstall, resetInstallState, useInstallMethod } from './install'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const MAC_SAFARI_16 =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15'
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const MAC_FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0'

listenForInstallPrompt()

function installPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome }),
  })
  act(() => void window.dispatchEvent(event))
  return event
}

function userAgent(agent: string, maxTouchPoints = 0) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent)
  // jsdom has no maxTouchPoints.
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true })
}

afterEach(() => {
  resetInstallState()
})

describe('getInstallMethod', () => {
  it('uses the Share menu steps in Safari on iPhone, iPad and Mac', () => {
    userAgent(IPHONE)
    expect(getInstallMethod()).toBe('ios')
    userAgent(MAC_SAFARI, 5) // iPadOS reports a Mac
    expect(getInstallMethod()).toBe('ios')
    userAgent(MAC_SAFARI)
    expect(getInstallMethod()).toBe('mac')
  })

  it('offers nothing where the browser can\'t install the app', () => {
    for (const agent of [MAC_SAFARI_16, MAC_CHROME, MAC_FIREFOX]) {
      userAgent(agent)
      expect(getInstallMethod()).toBeNull()
    }
  })

  it('offers nothing when already running as the app', () => {
    userAgent(IPHONE)
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    expect(getInstallMethod()).toBeNull()
  })
})

describe('install prompt', () => {
  it('keeps the browser prompt for later and shows it on request', async () => {
    userAgent(MAC_CHROME)
    const { result } = renderHook(() => useInstallMethod())
    expect(result.current).toBeNull()

    const event = installPrompt()
    expect(event.defaultPrevented).toBe(true)
    expect(result.current).toBe('prompt')

    let accepted = false
    await act(async () => {
      accepted = await promptInstall()
    })
    expect(event.prompt).toHaveBeenCalledOnce()
    expect(accepted).toBe(true)
    // A prompt can be shown only once.
    expect(result.current).toBeNull()
  })

  it('reports a dismissed prompt', async () => {
    installPrompt('dismissed')
    expect(await promptInstall()).toBe(false)
  })

  it('stops offering once the app is installed', () => {
    userAgent(IPHONE)
    const { result } = renderHook(() => useInstallMethod())
    act(() => void window.dispatchEvent(new Event('appinstalled')))
    expect(result.current).toBeNull()
  })
})
