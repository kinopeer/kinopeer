import type { Location } from 'react-router'

/**
 * Navigation state of a link to an overlay route (`/torrent/:hash`): the page it was opened from,
 * which `App` keeps rendering under the overlay on desktop.
 */
export interface BackgroundState {
  background?: Location
}

/** The state for a link that opens the torrent drawer over the page at `location`. */
export function overPage(location: Location): BackgroundState {
  return { background: location }
}

/** The page an overlay route was opened over, if it was opened from one. */
export function backgroundOf(location: Location): Location | undefined {
  return (location.state as BackgroundState | null)?.background
}
