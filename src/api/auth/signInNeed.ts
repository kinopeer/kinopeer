import type { SignInNeed } from './types'

/**
 * Whether Kinopeer's own login (server/auth.ts) holds the app back: set when a request is answered
 * with what it needs first (fetchKinopeer), cleared once the browser has signed in. The app shows
 * the sign-in or set-up screen in place of everything else while it's set (App.tsx). Kept apart
 * from React, so the clients set it without a DOM too.
 */
let need: SignInNeed | null = null
const listeners = new Set<() => void>()

/** What the app needs before Kinopeer's server answers it, or null when nothing. */
export function signInNeed(): SignInNeed | null {
  return need
}

export function setSignInNeed(next: SignInNeed | null): void {
  if (next === need) return
  need = next
  for (const listener of listeners) listener()
}

/** Calls `listener` when the need changes; returns a function that stops it. */
export function onSignInNeed(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
