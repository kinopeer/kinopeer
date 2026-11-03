import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakePoll } from '../test/render'
import { POLL_INTERVAL_MS, type PollState } from '../torrents/useMainData'
import { PollRing } from './PollRing'

const ANSWERED_AT = new Date(2026, 10, 3, 21, 5, 7).getTime()
// The space before PM differs between ICU versions.
const UPDATED = /^Updated at 9:05:07\sPM$/

const answered: PollState = { inFlight: false, offline: false, updatedAt: ANSWERED_AT }

/** The ring's state is only its look: the class is what fills it, pulses it or colors it, and no role shows it. */
const ringState = (ring: HTMLElement) => ['filling', 'waiting', 'offline'].find((state) => ring.classList.contains(`is-${state}`))

/** The arc that fills: decorative, found by its class. */
const fill = (container: HTMLElement) => container.querySelector('.poll-ring-fill')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(ANSWERED_AT)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PollRing', () => {
  it('waits for the first answer, from before the first request', () => {
    const { poll, set } = fakePoll()
    render(<PollRing poll={poll} />)
    const ring = screen.getByRole('img', { name: 'Waiting for qBittorrent' })
    expect(ringState(ring)).toBe('waiting')
    set({ inFlight: true })
    expect(ringState(ring)).toBe('waiting')
  })

  it('fills over the poll’s interval after an answer and says when the data was updated', () => {
    const { poll } = fakePoll(answered)
    render(<PollRing poll={poll} />)
    const ring = screen.getByRole('img', { name: UPDATED })
    expect(ringState(ring)).toBe('filling')
    expect(ring).toHaveStyle({ '--poll-interval': `${POLL_INTERVAL_MS}ms` })
  })

  it('waits while the next poll is in flight, still saying when the data was updated', () => {
    const { poll, set } = fakePoll(answered)
    const { container } = render(<PollRing poll={poll} />)
    const arc = fill(container)
    set({ inFlight: true })
    expect(ringState(screen.getByRole('img', { name: UPDATED }))).toBe('waiting')
    // The same arc: only an answer starts the filling over.
    expect(fill(container)).toBe(arc)
  })

  it('starts over with each answer', () => {
    const { poll, set } = fakePoll(answered)
    const { container } = render(<PollRing poll={poll} />)
    const arc = fill(container)
    set({ updatedAt: ANSWERED_AT + POLL_INTERVAL_MS })
    // A new element, so its CSS animation runs from the start.
    expect(fill(container)).not.toBe(arc)
    expect(ringState(screen.getByRole('img', { name: /^Updated at 9:05:09\sPM$/ }))).toBe('filling')
  })

  it('says qBittorrent isn’t answering, and since when the data is', () => {
    const { poll, set } = fakePoll({ ...answered, offline: true })
    render(<PollRing poll={poll} />)
    const ring = screen.getByRole('img', { name: /^qBittorrent isn’t answering · updated at 9:05:07\sPM$/ })
    expect(ringState(ring)).toBe('offline')
    // Offline wins over a retry in flight.
    set({ inFlight: true })
    expect(ringState(ring)).toBe('offline')
  })

  it('says qBittorrent isn’t answering before any answer', () => {
    const { poll } = fakePoll({ inFlight: false, offline: true, updatedAt: null })
    render(<PollRing poll={poll} />)
    expect(ringState(screen.getByRole('img', { name: 'qBittorrent isn’t answering' }))).toBe('offline')
  })
})
