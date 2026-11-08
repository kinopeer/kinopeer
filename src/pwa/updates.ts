import { fetchKinopeer } from '../api/fetchKinopeer'

/**
 * Brings an open app to a new version. A page kept in memory (the app on the Home Screen resumed
 * from the background, a tab left open) never navigates, so nothing loads the new bundle: over
 * plain HTTP there is no service worker at all, and over HTTPS the new worker takes over but the
 * page keeps the old scripts. So at startup and whenever the app comes back to the foreground, it
 * asks for the built version (version.json, written next to index.html by vite.config.ts) and
 * reloads when it differs and nothing is open.
 */

/** The built app's version, a static file, so it works without Kinopeer's server. */
export const VERSION_URL = '/version.json'

/** How long to wait for a new service worker to take over before trying on the next return. */
export const TAKEOVER_TIMEOUT_MS = 10_000

/** The version this session last reloaded for: once per version, so a page that stays old doesn't reload in a loop. */
const RELOADED_FOR_KEY = 'kinopeer.reloadedFor'

async function serverVersion(): Promise<string | null> {
  try {
    const response = await fetchKinopeer(VERSION_URL, { cache: 'no-store' })
    // An error page or index.html in its place isn't JSON with a version either.
    const { version } = (await response.json()) as { version?: unknown }
    return typeof version === 'string' ? version : null
  } catch {
    // Offline, or not JSON: a server without the file answers with index.html or a 404 page.
    return null
  }
}

/**
 * Over HTTPS the page is served by the service worker, which would answer a reload with the old
 * shell: has the worker look for the new version and waits until it takes the page. Resolves to
 * whether a reload gets the new version.
 */
async function newWorkerInControl(): Promise<boolean> {
  // Plain HTTP has no service workers at all.
  if (!navigator.serviceWorker) return true
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return true
    const takeover = new Promise<boolean>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), { once: true })
      // Resolving after the takeover changes nothing, so the timer isn't cleared.
      setTimeout(() => resolve(false), TAKEOVER_TIMEOUT_MS)
    })
    await registration.update()
    // Nothing new installing: the worker in control already has the new version.
    if (!registration.installing && !registration.waiting) return true
    return await takeover
  } catch {
    return false
  }
}

/**
 * A sheet, a dialog or the drawer, or a field being filled outside them (a login, a key in
 * Settings, often left to copy the rest): a reload would throw away what's in it.
 */
const somethingOpen = () => document.querySelector('dialog[open], input:focus, textarea:focus') !== null

function reloadedFor(): string | null {
  try {
    return sessionStorage.getItem(RELOADED_FOR_KEY)
  } catch {
    return null
  }
}

/** Remembers that this session reloads for `version`. */
export function markReloadedFor(version: string): void {
  try {
    sessionStorage.setItem(RELOADED_FOR_KEY, version)
  } catch {
    // Not remembered: no loop guard and no "updated" toast, the reload still happens.
  }
}

/** Whether this page is the version the session reloaded for, once: the app says it was updated. */
export function takeJustUpdated(): boolean {
  if (reloadedFor() !== __APP_VERSION__) return false
  // The storage answered just now, so this doesn't throw.
  sessionStorage.removeItem(RELOADED_FOR_KEY)
  return true
}

/** Checks now and on every return to the foreground. Returns a function that stops it. */
export function startUpdateChecks(reload: () => void = () => window.location.reload()): () => void {
  let checking = false
  const check = async () => {
    if (checking) return
    checking = true
    try {
      const version = await serverVersion()
      if (!version || version === __APP_VERSION__ || version === reloadedFor() || somethingOpen()) return
      if (!(await newWorkerInControl()) || document.hidden || somethingOpen()) return
      markReloadedFor(version)
      reload()
    } finally {
      checking = false
    }
  }
  const onVisibilityChange = () => {
    if (!document.hidden) void check()
  }
  void check()
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => document.removeEventListener('visibilitychange', onVisibilityChange)
}
