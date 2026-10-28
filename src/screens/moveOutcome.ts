import { createContext } from 'react'
import type { MoveFailure } from './MoveTorrentSheet'

/** How a move went: the folder qBittorrent took, or why it didn't take it. */
export type MoveOutcome = { moved: string } | { failed: MoveFailure }

/**
 * Says how a move went once the screen that started it is gone (`MoveOutcomeProvider`), so a move
 * still being sent when the user goes Back is reported on the next screen.
 */
export const MoveOutcomeContext = createContext<((outcome: MoveOutcome) => void) | null>(null)
