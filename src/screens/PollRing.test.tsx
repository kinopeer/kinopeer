import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
    expect(ring).toHaveAttribute('title', ring.getAttribute('aria-label'))
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

  it('says what it’s given before the update time in its tooltip, not in its name', () => {
    const { poll } = fakePoll(answered)
    render(<PollRing poll={poll} context="qBittorrent 5.0.1" />)
    const ring = screen.getByRole('img', { name: UPDATED })
    expect(ring).toHaveAttribute('title', expect.stringMatching(/^qBittorrent 5\.0\.1 · Updated at 9:05:07\sPM$/))
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

  it('says Kinopeer isn’t answering when Kinopeer’s server is who didn’t, with or without an answer before', () => {
    const { poll, set } = fakePoll({ inFlight: false, offline: true, unreachable: 'kinopeer', updatedAt: null })
    render(<PollRing poll={poll} />)
    expect(screen.getByRole('img', { name: 'Kinopeer isn’t answering' })).toBeInTheDocument()
    set({ ...answered, offline: true, unreachable: 'kinopeer' })
    expect(screen.getByRole('img', { name: /^Kinopeer isn’t answering · updated at / })).toBeInTheDocument()
  })

  it('says qBittorrent isn’t answering before any answer', () => {
    const { poll } = fakePoll({ inFlight: false, offline: true, updatedAt: null })
    render(<PollRing poll={poll} />)
    expect(ringState(screen.getByRole('img', { name: 'qBittorrent isn’t answering' }))).toBe('offline')
  })
})

describe('PollRing.css', () => {
  // Vitest runs from the project root (import.meta.url isn't a file URL under jsdom).
  const css = readFileSync(join(process.cwd(), 'src/screens/PollRing.css'), 'utf8')

  /** The properties each @keyframes rule animates, by the rule's name. */
  const animated = () =>
    Object.fromEntries(
      [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)].map(([, name, body]) => [
        name,
        [...new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map(([, property]) => property))],
      ]),
    )

  /** The stylesheet without its `@media (prefers-reduced-motion: no-preference)` blocks, and those blocks. */
  const byMotion = () => {
    const opening = /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{/g
    let rest = css
    const moving: string[] = []
    for (let match = opening.exec(rest); match !== null; match = opening.exec(rest)) {
      let depth = 1
      let end = match.index + match[0].length
      for (; depth > 0 && end < rest.length; end++) depth += rest[end] === '{' ? 1 : rest[end] === '}' ? -1 : 0
      moving.push(rest.slice(match.index, end))
      rest = rest.slice(0, match.index) + rest.slice(end)
      opening.lastIndex = match.index
    }
    return { rest, moving: moving.join('\n') }
  }

  it('fills and pulses only without reduced motion, a full ring otherwise', () => {
    const { rest, moving } = byMotion()
    expect(rest).not.toMatch(/(?:^|[;{\s])animation(?:-name)?\s*:/)
    expect(moving).toMatch(/animation\s*:\s*poll-ring-first\b/)
    expect(moving).toMatch(/animation\s*:\s*poll-ring-second\b/)
    expect(moving).toMatch(/animation\s*:\s*poll-ring-wait\b/)
  })

  it('animates only what the compositor runs, so the ring repaints nothing while it fills or pulses', () => {
    // stroke-dashoffset ran on the main thread every frame: 220 ms/s of an idle phone list at 4× CPU (#220).
    expect(animated()).toEqual({
      'poll-ring-first': ['transform'],
      'poll-ring-second': ['transform'],
      'poll-ring-wait': ['opacity'],
    })
  })
})
