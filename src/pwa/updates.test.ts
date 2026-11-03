import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TAKEOVER_TIMEOUT_MS, VERSION_URL, markReloadedFor, startUpdateChecks, takeJustUpdated } from './updates'

const NEW = `${__APP_VERSION__}+new`

const reload = vi.fn()
let stop: () => void = () => {}

/** The server's answer for version.json: a version, or a whole Response for the odd cases. */
function serverHas(answer: string | Response) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(typeof answer === 'string' ? Response.json({ version: answer }) : answer.clone()),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Lets the version check and what it waits for run. */
const settle = () => vi.advanceTimersByTimeAsync(0)

/** Pretends the app went to the background or came back to the foreground. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

/**
 * A service worker registration whose update() leaves a new worker `next` (installing or, installed,
 * waiting) or finds nothing new (null).
 */
function serviceWorker({
  next = 'installing',
  fails = false,
  registered = true,
}: { next?: 'installing' | 'waiting' | null; fails?: boolean; registered?: boolean } = {}) {
  const container = new EventTarget()
  const registration = {
    installing: null as object | null,
    waiting: null as object | null,
    update: vi.fn(() => {
      if (fails) return Promise.reject(new TypeError('offline'))
      if (next) registration[next] = {}
      return Promise.resolve()
    }),
  }
  Object.assign(container, { getRegistration: () => Promise.resolve(registered ? registration : undefined) })
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true })
  /** The new worker takes the page: it's the active one now, so update() finds nothing newer. */
  const takeOver = () => {
    registration.installing = registration.waiting = null
    next = null
    container.dispatchEvent(new Event('controllerchange'))
  }
  return { registration, takeOver }
}

beforeEach(() => {
  vi.useFakeTimers()
  reload.mockReset()
})

afterEach(() => {
  stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  sessionStorage.clear()
  document.body.replaceChildren()
  Reflect.deleteProperty(document, 'hidden')
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('startUpdateChecks', () => {
  it('reloads when the server has another version', async () => {
    const fetchMock = serverHas(NEW)
    stop = startUpdateChecks(reload)
    await settle()
    expect(fetchMock).toHaveBeenCalledWith(VERSION_URL, expect.objectContaining({ cache: 'no-store' }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('stays on the same version', async () => {
    serverHas(__APP_VERSION__)
    stop = startUpdateChecks(reload)
    await settle()
    expect(reload).not.toHaveBeenCalled()
  })

  it('stays when the server says nothing it can read', async () => {
    for (const answer of [
      new Response('Not found', { status: 404 }),
      // A server or a dev server without the file answers with the app's index.html.
      new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }),
      Response.json({ version: 7 }),
    ]) {
      serverHas(answer)
      stop = startUpdateChecks(reload)
      await settle()
      stop()
    }
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
    stop = startUpdateChecks(reload)
    await settle()
    expect(reload).not.toHaveBeenCalled()
  })

  it('checks again when the app comes back to the foreground', async () => {
    serverHas(__APP_VERSION__)
    stop = startUpdateChecks(reload)
    await settle()

    const fetchMock = serverHas(NEW)
    setHidden(true)
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    setHidden(false)
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('waits while a sheet or a dialog is open', async () => {
    const dialog = document.body.appendChild(document.createElement('dialog'))
    dialog.setAttribute('open', '')
    serverHas(NEW)
    stop = startUpdateChecks(reload)
    await settle()
    expect(reload).not.toHaveBeenCalled()

    dialog.remove()
    setHidden(true)
    setHidden(false)
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads once for a version, so a page that stays old doesn\'t reload again and again', async () => {
    serverHas(NEW)
    stop = startUpdateChecks(reload)
    await settle()
    stop()
    // The reloaded page: the same session, still the old bundle.
    stop = startUpdateChecks(reload)
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('waits for the new service worker to take over before reloading', async () => {
    const { registration, takeOver } = serviceWorker()
    serverHas(NEW)
    stop = startUpdateChecks(reload)
    await settle()
    expect(registration.update).toHaveBeenCalledOnce()
    // Reloading now would get the old shell from the old worker.
    expect(reload).not.toHaveBeenCalled()

    takeOver()
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('waits for a new service worker left waiting, too', async () => {
    const { takeOver } = serviceWorker({ next: 'waiting' })
    serverHas(NEW)
    stop = startUpdateChecks(reload)
    await settle()
    expect(reload).not.toHaveBeenCalled()

    takeOver()
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('doesn\'t reload when a sheet opened while it waited for the service worker', async () => {
    const { takeOver } = serviceWorker()
    serverHas(NEW)
    stop = startUpdateChecks(reload)
    await settle()
    const dialog = document.body.appendChild(document.createElement('dialog'))
    dialog.setAttribute('open', '')
    takeOver()
    await settle()
    expect(reload).not.toHaveBeenCalled()

    dialog.remove()
    setHidden(true)
    setHidden(false)
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('doesn\'t reload when the app went to the background while it waited for the service worker', async () => {
    const { takeOver } = serviceWorker()
    serverHas(NEW)
    stop = startUpdateChecks(reload)
    await settle()
    setHidden(true)
    takeOver()
    await settle()
    expect(reload).not.toHaveBeenCalled()

    setHidden(false)
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads right away when no service worker is registered yet', async () => {
    serviceWorker({ registered: false })
    serverHas(NEW)
    stop = startUpdateChecks(reload)
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('checks once at a time, so returns while it waits for the service worker don\'t ask it again', async () => {
    const { registration, takeOver } = serviceWorker()
    serverHas(NEW)
    stop = startUpdateChecks(reload)
    await settle()
    setHidden(true)
    setHidden(false)
    await settle()
    expect(registration.update).toHaveBeenCalledOnce()

    takeOver()
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('still reloads when the session\'s storage is blocked', async () => {
    for (const method of ['getItem', 'setItem'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      })
    }
    serverHas(NEW)
    stop = startUpdateChecks(reload)
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads right away when the service worker has nothing newer to install', async () => {
    serviceWorker({ next: null })
    serverHas(NEW)
    stop = startUpdateChecks(reload)
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('tries again later when the new service worker doesn\'t come', async () => {
    const { registration } = serviceWorker({ fails: true })
    serverHas(NEW)
    stop = startUpdateChecks(reload)
    await settle()
    expect(reload).not.toHaveBeenCalled()

    registration.update.mockImplementation(() => {
      registration.installing = {}
      return Promise.resolve()
    })
    setHidden(true)
    setHidden(false)
    await vi.advanceTimersByTimeAsync(TAKEOVER_TIMEOUT_MS)
    expect(reload).not.toHaveBeenCalled()

    // Neither attempt counted as the one reload for this version.
    registration.update.mockImplementation(() => Promise.resolve())
    registration.installing = null
    setHidden(true)
    setHidden(false)
    await settle()
    expect(reload).toHaveBeenCalledOnce()
  })
})

describe('takeJustUpdated', () => {
  it('is true once, on the version the session reloaded for', () => {
    expect(takeJustUpdated()).toBe(false)
    markReloadedFor(NEW)
    // The reload got the old bundle: not updated.
    expect(takeJustUpdated()).toBe(false)
    markReloadedFor(__APP_VERSION__)
    expect(takeJustUpdated()).toBe(true)
    expect(takeJustUpdated()).toBe(false)
  })
})
