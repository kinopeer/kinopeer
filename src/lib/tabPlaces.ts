import { useSyncExternalStore } from 'react'

/**
 * Where a tab was left: the query of its screen (the Search tab's `q`, `type` and `year`) and the
 * window's scroll. A tab is named by its path (`/`, `/search`, `/settings`).
 */
export interface TabPlace {
  /** `location.search`, with its `?`, or empty. */
  search: string
  y: number
}

/** In sessionStorage, so a reload keeps them, as it keeps the positions by history entry. */
const STORAGE_KEY = 'kinoseed.tabs'

type Places = Readonly<Record<string, TabPlace>>

const EMPTY: Places = {}
let places: Places | null = null
const listeners = new Set<() => void>()

function isPlace(value: unknown): value is TabPlace {
  const place = value as Partial<TabPlace> | null
  return typeof place?.search === 'string' && typeof place.y === 'number'
}

function read(): Places {
  if (places) return places
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}')
    places = Object.fromEntries(
      Object.entries(stored && typeof stored === 'object' ? stored : {}).filter(([, place]) => isPlace(place)),
    )
  } catch {
    places = EMPTY
  }
  return places
}

/** Where the tab was left, if it was. */
export function tabPlace(tab: string): TabPlace | undefined {
  return read()[tab]
}

/** Keeps where the tab is being left, for its link and for the screen to come back to. */
export function saveTabPlace(tab: string, place: TabPlace): void {
  places = { ...read(), [tab]: place }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(places))
  } catch {
    // Storage is full or blocked: the places last as long as the page.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The query the tab was left with ('' when none), kept current for its link. */
export function useTabSearch(tab: string): string {
  return useSyncExternalStore(subscribe, () => read()[tab]?.search ?? '')
}

/** The navigation state of a tab's link: the screen it opens comes back to where the tab was left. */
export interface TabReturnState {
  tabReturn: true
}

export const TAB_RETURN: TabReturnState = { tabReturn: true }

export function isTabReturn(state: unknown): boolean {
  return (state as Partial<TabReturnState> | null)?.tabReturn === true
}

/** Forgets every place (tests start from none). */
export function forgetTabPlaces(): void {
  places = null
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing kept to forget.
  }
}
