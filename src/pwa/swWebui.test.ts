import { describe, expect, it, vi } from 'vitest'
import { KINOPEER_PAGE_MARK, forgetWorker, isKinopeerPage, loadPage } from './swWebui'

const KINOPEER = `<!doctype html><html><head>${KINOPEER_PAGE_MARK} /><title>Kinopeer</title></head></html>`
const QBITTORRENT = '<!doctype html><html><head><title>qBittorrent WebUI</title></head></html>'
const page = (html: string, init?: ResponseInit) => new Response(html, { headers: { 'Content-Type': 'text/html' }, ...init })

describe('isKinopeerPage', () => {
  it('takes a page with Kinopeer’s mark', async () => {
    expect(await isKinopeerPage(page(KINOPEER))).toBe(true)
  })

  it.each([
    ['qBittorrent’s own interface', page(QBITTORRENT)],
    ['qBittorrent’s refusal of a folder with no index.html', page('Unacceptable file type, only regular file is allowed.', { status: 500 })],
    ['an error page that has the mark', page(KINOPEER, { status: 502 })],
    ['a redirect, as to a sign-in page', Response.redirect('https://sign-in.example.com/', 302)],
  ])('refuses %s', async (_what, response) => {
    expect(await isKinopeerPage(response)).toBe(false)
  })

  it('leaves the answer’s body for the browser', async () => {
    const response = page(KINOPEER)
    await isKinopeerPage(response)
    expect(await response.text()).toBe(KINOPEER)
  })
})

describe('loadPage', () => {
  const request = new Request('http://192.168.1.2:8080/')
  const cached = page(KINOPEER)

  function stand(answer: () => Promise<Response>, { precached = true } = {}) {
    return { fetch: vi.fn(answer), cachedPage: vi.fn(async () => (precached ? cached : undefined)), forget: vi.fn(async () => {}) }
  }

  it('answers with Kinopeer’s page from the network, and keeps the worker', async () => {
    const fresh = page(KINOPEER)
    const load = stand(async () => fresh)
    expect(await loadPage(request, load)).toBe(fresh)
    expect(load.fetch).toHaveBeenCalledWith(request)
    expect(load.cachedPage).not.toHaveBeenCalled()
    expect(load.forget).not.toHaveBeenCalled()
  })

  // Kinopeer turned off in qBittorrent's settings: the same address answers with qBittorrent's own interface.
  it('answers with another page as it is, and forgets the worker before it does', async () => {
    const other = page(QBITTORRENT)
    const order: string[] = []
    const load = stand(async () => other)
    // Forgetting takes a while, as unregistering and deleting caches do; the answer waits for it.
    load.forget.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      order.push('forgot')
    })
    const answer = await loadPage(request, load).then((response) => (order.push('answered'), response))
    expect(answer).toBe(other)
    expect(order).toEqual(['forgot', 'answered'])
    expect(load.cachedPage).not.toHaveBeenCalled()
  })

  it('opens the precached index.html when the network doesn’t answer', async () => {
    const load = stand(async () => Promise.reject(new TypeError('Failed to fetch')))
    expect(await loadPage(request, load)).toBe(cached)
    expect(load.forget).not.toHaveBeenCalled()
  })

  it('passes the network’s error on when nothing is precached', async () => {
    const failure = new TypeError('Failed to fetch')
    const load = stand(async () => Promise.reject(failure), { precached: false })
    await expect(loadPage(request, load)).rejects.toBe(failure)
    expect(load.forget).not.toHaveBeenCalled()
  })
})

describe('forgetWorker', () => {
  it('unregisters the worker and deletes its own caches only', async () => {
    const registration = { unregister: vi.fn(async () => true) }
    const caches = { delete: vi.fn(async () => true) }
    await forgetWorker({ registration, caches }, ['workbox-precache-v2-http://192.168.1.2:8080/', 'tmdb-images'])
    expect(registration.unregister).toHaveBeenCalledOnce()
    expect(caches.delete.mock.calls).toEqual([['workbox-precache-v2-http://192.168.1.2:8080/'], ['tmdb-images']])
  })
})
