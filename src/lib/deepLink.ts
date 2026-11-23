/** What a screen keeps in its entry's state when it replaces the entry (TitleScreen, useReleases). */
export interface DeepLinkState {
  /** The screen was opened from a link, so Back has nowhere to go in the app. */
  deepLink?: boolean
}

/**
 * Whether the screen was opened from a link rather than from inside the app: the document's first
 * entry (`'default'`), or an entry that replaced it and said so, since a replaced entry gets a key of
 * its own.
 */
export function isDeepLink(location: { key: string; state: unknown }): boolean {
  return location.key === 'default' || (location.state as DeepLinkState | null)?.deepLink === true
}
