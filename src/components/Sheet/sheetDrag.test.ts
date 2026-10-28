import { describe, expect, it } from 'vitest'
import { CLOSE_DISTANCE, CLOSE_SHARE, FLICK_DISTANCE, FLICK_WINDOW, shouldClose } from './sheetDrag'

const slow = { speed: 0.1, idle: 0, height: 0 }

// Which input the drag passes in is Sheet.test.tsx's (dragged far, flicked, held still, a tall
// sheet); these are the edges of the rule.
describe('shouldClose', () => {
  it('closes once dragged the fixed distance, however slowly', () => {
    expect(shouldClose({ ...slow, distance: CLOSE_DISTANCE })).toBe(true)
    expect(shouldClose({ ...slow, distance: CLOSE_DISTANCE - 1 })).toBe(false)
  })

  it("needs a share of a tall sheet's height rather than the fixed distance", () => {
    const height = 1000
    const share = height * CLOSE_SHARE
    expect(share).toBeGreaterThan(CLOSE_DISTANCE)
    expect(shouldClose({ ...slow, height, distance: share - 1 })).toBe(false)
    expect(shouldClose({ ...slow, height, distance: share })).toBe(true)
  })

  it('takes a flick only if let go soon after the last move', () => {
    const flick = { distance: 40, speed: 1, height: 600 }
    expect(shouldClose({ ...flick, idle: FLICK_WINDOW })).toBe(true)
    expect(shouldClose({ ...flick, idle: FLICK_WINDOW + 1 })).toBe(false)
  })

  it("doesn't take a tap that wobbles for a flick, however fast", () => {
    expect(shouldClose({ distance: FLICK_DISTANCE - 1, speed: 2, idle: 0, height: 600 })).toBe(false)
    expect(shouldClose({ distance: FLICK_DISTANCE, speed: 2, idle: 0, height: 600 })).toBe(true)
  })

  it('never closes on a drag up', () => {
    expect(shouldClose({ distance: -200, speed: -2, idle: 0, height: 600 })).toBe(false)
  })
})
