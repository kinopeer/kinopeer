import { useSyncExternalStore } from 'react'

/** Chromium's install prompt event; not in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * How Kinopeer can be installed in this browser: through the browser's own prompt (Chromium on
 * Android and desktop), by hand from the Share menu (Safari on iPhone and iPad, Safari 17+ on a
 * Mac), or not at all (already installed or running as the app, or a browser that can't).
 */
export type InstallMethod = 'prompt' | 'ios' | 'mac' | null

/** Platforms that install by hand, with steps in InstallSheet. */
export type ManualInstall = Exclude<InstallMethod, 'prompt' | null>

const DISMISSED_STORAGE_KEY = 'kinopeer.installDismissed'

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

/**
 * Catches the browser's install prompt for later. Call once at startup: the event can fire before
 * any screen is rendered.
 */
export function listenForInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    notify()
  })
}

function runningAsApp(): boolean {
  return (
    !!window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function manualInstall(): ManualInstall | null {
  const agent = navigator.userAgent
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  if (/iPad|iPhone|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return 'ios'
  // "Add to Dock" arrived in Safari 17. Other Mac browsers either send a prompt or can't install.
  const safari = /Macintosh/.test(agent) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(agent)
  const version = Number(/Version\/(\d+)/.exec(agent)?.[1])
  return safari && version >= 17 ? 'mac' : null
}

export function getInstallMethod(): InstallMethod {
  if (installed || runningAsApp()) return null
  if (deferred) return 'prompt'
  return manualInstall()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useInstallMethod(): InstallMethod {
  return useSyncExternalStore(subscribe, getInstallMethod)
}

/** Shows the browser's install prompt. Resolves to whether the user installed Kinopeer. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred
  if (!event) return false
  // A prompt can be shown only once; the browser sends a new event if it may ask again.
  deferred = null
  notify()
  await event.prompt()
  return (await event.userChoice).outcome === 'accepted'
}

export function isInstallCardDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissInstallCard(): void {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, '1')
  } catch {
    // Not persisted; the card stays hidden until the next launch.
  }
}

/** Test helper: forgets the captured prompt and the installed flag. */
export function resetInstallState(): void {
  deferred = null
  installed = false
  notify()
}
