import { afterEach, describe, expect, it } from 'vitest'
import { contentSecurityPolicy, securityHeaders } from './securityHeaders.ts'
import { closeServers, serve } from './test/fakes.ts'

afterEach(closeServers)

describe('securityHeaders', () => {
  it('marks the answer of whatever comes after it', async () => {
    const app = await serve(securityHeaders)

    const response = await fetch(`${app}/anything`)

    // The route after it answered.
    expect(await response.text()).toBe('fallback')
    // Nothing is read as another type than it's sent as, an HTML page from a bridge included.
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    // No other site shows Kinopeer in a frame, to have its buttons clicked unseen.
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    // A link out (an indexer's page, TMDB) doesn't tell the site Kinopeer's address.
    expect(response.headers.get('referrer-policy')).toBe('same-origin')
    // Nothing Kinopeer never uses is there for a script to ask for.
    expect(response.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()')
    // A page Kinopeer opens or that opens Kinopeer gets no hold on its window.
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin')
  })

  it('limits a page to Kinopeer’s own files with the Content-Security-Policy', async () => {
    const app = await serve(contentSecurityPolicy)

    const response = await fetch(`${app}/anything`)

    expect(await response.text()).toBe('fallback')
    const policy = new Map(
      response.headers
        .get('content-security-policy')!
        .split(';')
        .map((directive) => directive.trim().split(/\s+/))
        .map(([name, ...sources]) => [name, sources.join(' ')]),
    )
    expect(Object.fromEntries(policy)).toEqual({
      // Scripts, styles, fonts, API calls, the service worker and the manifest: the app's own,
      // with no inline script or `javascript:` link.
      'default-src': "'self'",
      // Vite inlines small images as data: URLs (TMDB's logo in Settings).
      'img-src': "'self' data:",
      'object-src': "'none'",
      // An injected tag can't send the app's links or forms elsewhere.
      'base-uri': "'none'",
      'form-action': "'self'",
      // X-Frame-Options for browsers that read only this.
      'frame-ancestors': "'none'",
    })
  })
})
