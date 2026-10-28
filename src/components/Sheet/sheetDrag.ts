/** How far down a let-go sheet closes: this many px, or this share of its height if that's more. */
export const CLOSE_DISTANCE = 96
export const CLOSE_SHARE = 0.3
/** A flick down at least this fast (px/ms) and this far (px, so a wobbly tap isn't one) closes it. */
export const CLOSE_SPEED = 0.5
export const FLICK_DISTANCE = 20
/** Ms without a move before letting go after which the flick no longer counts. */
export const FLICK_WINDOW = 100

export interface Release {
  /** Px down from where the drag started; negative is up. */
  distance: number
  /** Px/ms down at the last move. */
  speed: number
  /** Ms between the last move and letting go. */
  idle: number
  /** The sheet's height in px. */
  height: number
}

/** Whether a sheet let go after a drag closes, or springs back. */
export function shouldClose({ distance, speed, idle, height }: Release): boolean {
  if (distance >= Math.max(CLOSE_DISTANCE, height * CLOSE_SHARE)) return true
  // Held still before letting go: no move came to say the flick had stopped.
  return idle <= FLICK_WINDOW && distance >= FLICK_DISTANCE && speed >= CLOSE_SPEED
}
