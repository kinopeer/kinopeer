/* oxlint-disable react/only-export-components -- test helpers, never hot-reloaded */
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation, type InitialEntry } from 'react-router'
import { expect, onTestFinished } from 'vitest'
import { QbittorrentError } from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { ROUTER_OPTIONS } from '../lib/routerOptions'
import type { PollSource, PollState } from '../torrents/useMainData'

/**
 * Renders `ui` under a MemoryRouter with the app's options (`ROUTER_OPTIONS`) at the last of `entries`
 * (strings, or locations with state) and a `ToastProvider`, as screens that read the URL, navigate or
 * show toasts need. A test that renders `<Routes>` puts them in `ui`.
 */
export function renderWithRouter(ui: ReactNode, entries: InitialEntry[] = ['/']) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1} {...ROUTER_OPTIONS}>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  )
}

/** Shows the current path, for a test that checks where a screen navigated; read it with `where()`. */
export function Where() {
  return <output aria-label="Location">{useLocation().pathname}</output>
}

export const where = () => screen.getByRole('status', { name: 'Location' }).textContent

const normalized = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim()

/**
 * Picks a live region (a toast, an error banner) by what it says, as the `name` in
 * `findByRole('status', { name: saying('Torrent deleted') })`: a status or alert takes no name from its
 * text. Like `getByText`, a string matches a whole text, the region's or one of its elements' (a
 * banner's title or body), so "12 torrents deleted" isn't "2 torrents deleted"; a RegExp is for a
 * part of a longer message. It waits for that text even while other regions with the role are up.
 */
export function saying(text: string | RegExp) {
  const says = (node: Element) =>
    typeof text === 'string' ? normalized(node.textContent) === text : text.test(normalized(node.textContent))
  const matcher = (_name: string, element: Element) => [element, ...element.querySelectorAll('*')].some(says)
  // What a failed query prints in place of the function's source.
  matcher.toString = () => `saying(${String(text)})`
  return matcher
}

/**
 * The toast that says `text`, once no sheet, dialog or drawer is open. A toast shown while one is
 * open shows inside it and moves to the page when it closes, so one found before it closed would be
 * detached by the next assertion, and the test would fail only now and then (#190).
 */
export async function findToastOnPage(text: string | RegExp) {
  await waitFor(() => expect(document.querySelector('dialog[open]')).toBeNull())
  return screen.findByRole('status', { name: saying(text) })
}

/** The poll's state (`PollSource`) as the test sets it, for what shows it or needs one to pass on. */
export function fakePoll(initial: PollState = { inFlight: false, offline: false, updatedAt: null }) {
  let state = initial
  const listeners = new Set<() => void>()
  const poll: PollSource = {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getPollState: () => state,
  }
  const set = (changes: Partial<PollState>) =>
    act(() => {
      state = { ...state, ...changes }
      listeners.forEach((listener) => listener())
    })
  return { poll, set }
}

/** The bridge's own failure when qBittorrent doesn't answer (server/qbittorrent.ts), as the client throws it. */
export const qbittorrentDown = () => new QbittorrentError('qBittorrent responded 502', 502)

/**
 * A service worker answers the page, as over HTTPS (jsdom has none): Open again shows only then.
 * With `null`, the worker is there but hasn't taken the page yet; set `controller` and dispatch
 * `controllerchange` on what it returns to have it take it.
 */
export function controlledByServiceWorker(controller: object | null = {}) {
  const container = Object.assign(new EventTarget(), { controller })
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true })
  onTestFinished(() => void Reflect.deleteProperty(navigator, 'serviceWorker'))
  return container
}
