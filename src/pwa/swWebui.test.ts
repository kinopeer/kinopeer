import { afterEach, describe, expect, it, vi } from 'vitest'
import { KINOPEER_PAGE_MARK, PAGE_TIMEOUT_MS, WEBUI_PAGES, forgetWorker, loadPage, pageAnswer } from './swWebui'

const KINOPEER = `<!doctype html><html><head>${KINOPEER_PAGE_MARK} /><title>Kinopeer</title></head></html>`
const QBITTORRENT = '<!doctype html><html><head><title>qBittorrent WebUI</title></head></html>'
const page = (html: string, init?: ResponseInit) => new Response(html, { headers: { 'Content-Type': 'text/html' }, ...init })

/** An answer whose body breaks off as it's read, as when the connection drops mid-body. */
const brokenOff = () =>
  new Response(
    new ReadableStream({
      pull(controller) {
        controller.error(new TypeError('network error'))
      },
    }),
  )

describe('pageAnswer', () => {
  it('takes a page with Kinopeer’s mark for Kinopeer’s', async () => {
    expect(await pageAnswer(page(KINOPEER))).toBe('kinopeer')
  })

  it.each([
    ['qBittorrent’s own interface', page(QBITTORRENT)],
    ['qBittorrent’s refusal of a folder with no index.html', page('Unacceptable file type, only regular file is allowed.', { status: 500 })],
    ['a redirect, as to a sign-in page', Response.redirect('https://sign-in.example.com/', 302)],
    ['a proxy’s sign-in refusal', page('Unauthorized', { status: 401 })],
  ])('takes %s for another page', async (_what, response) => {
    expect(await pageAnswer(response)).toBe('other')
  })

  // nginx, Caddy and other proxies answer so while qBittorrent behind them restarts or is down.
  it.each([502, 503, 504])('takes a proxy’s %i for nothing usable, the mark or not', async (status) => {
    expect(await pageAnswer(page('Bad Gateway', { status }))).toBe('unanswered')
    expect(await pageAnswer(page(KINOPEER, { status }))).toBe('unanswered')
  })

  it('takes a body that broke off for nothing usable', async () => {
    expect(await pageAnswer(brokenOff())).toBe('unanswered')
  })

  it('leaves the answer’s body for the browser', async () => {
    const response = page(KINOPEER)
    await pageAnswer(response)
    expect(await response.text()).toBe(KINOPEER)
  })
})

describe('loadPage', () => {
  const request = new Request('http://192.168.1.2:8080/')
  const cached = page(KINOPEER)

  function stand(answer: () => Promise<Response>, { precached = true } = {}) {
    return { fetch: vi.fn(answer), cachedPage: vi.fn(async () => (precached ? cached : undefined)), forget: vi.fn(async () => {}) }
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers with Kinopeer’s page from the network, and keeps the worker', async () => {
    const fresh = page(KINOPEER)
    const load = stand(async () => fresh)
    expect(await loadPage(request, load)).toBe(fresh)
    expect(load.fetch).toHaveBeenCalledWith(request)
    expect(load.cachedPage).not.toHaveBeenCalled()
    expect(load.forget).not.toHaveBeenCalled()
  })

  // Kinopeer turned off in qBittorrent's settings: the same address answers with qBittorrent's own interface.
  it('answers with another page as it is, once the worker is forgotten', async () => {
    const other = page(QBITTORRENT)
    const load = stand(async () => other)
    let forgotten = () => {}
    load.forget.mockImplementation(() => new Promise<void>((resolve) => (forgotten = resolve)))
    let answered = false
    const answer = loadPage(request, load).then((response) => ((answered = true), response))
    await vi.waitFor(() => expect(load.forget).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(answered).toBe(false)
    forgotten()
    expect(await answer).toBe(other)
    expect(load.cachedPage).not.toHaveBeenCalled()
  })

  it('hands another page on when forgetting the worker fails', async () => {
    const other = page(QBITTORRENT)
    const load = stand(async () => other)
    load.forget.mockRejectedValue(new DOMException('Storage failed', 'UnknownError'))
    expect(await loadPage(request, load)).toBe(other)
  })

  it.each([
    ['the network doesn’t answer', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a proxy answers 502 for qBittorrent', async () => page('Bad Gateway', { status: 502 })],
    ['the body breaks off', async () => brokenOff()],
  ])('opens the precached index.html and keeps the worker when %s', async (_when, answer) => {
    const load = stand(answer)
    expect(await loadPage(request, load)).toBe(cached)
    expect(load.forget).not.toHaveBeenCalled()
  })

  // A qBittorrent that takes the connection and doesn't answer, or a proxy waiting on it.
  it('opens the precached index.html when the network takes longer than PAGE_TIMEOUT_MS', async () => {
    vi.useFakeTimers()
    const load = stand(() => new Promise<Response>(() => {}))
    let answer: Response | undefined
    void loadPage(request, load).then((response) => (answer = response))
    await vi.advanceTimersByTimeAsync(PAGE_TIMEOUT_MS - 1)
    expect(answer).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(answer).toBe(cached)
    expect(load.forget).not.toHaveBeenCalled()
  })

  it('passes the network’s error on when nothing is precached', async () => {
    const failure = new TypeError('Failed to fetch')
    const load = stand(async () => Promise.reject(failure), { precached: false })
    await expect(loadPage(request, load)).rejects.toBe(failure)
    expect(load.forget).not.toHaveBeenCalled()
  })

  it('hands a proxy’s gateway error on when nothing is precached', async () => {
    const gateway = page('Bad Gateway', { status: 502 })
    const load = stand(async () => gateway, { precached: false })
    expect(await loadPage(request, load)).toBe(gateway)
    expect(load.forget).not.toHaveBeenCalled()
  })
})

describe('WEBUI_PAGES', () => {
  const taken = (path: string) => WEBUI_PAGES.some((pattern) => pattern.test(path))

  it.each(['/', '/index.html', '/?proxy-sign-in=1'])('takes the app’s page, %s', (path) => {
    expect(taken(path)).toBe(true)
  })

  // Opened in a tab, each answers without the mark, which must not read as Kinopeer turned off.
  it.each(['/version.json', '/manifest.webmanifest', '/icons/icon-192.png', '/api/v2/app/version', '/index.html.bak', '/search'])('leaves %s to the network', (path) => {
    expect(taken(path)).toBe(false)
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
