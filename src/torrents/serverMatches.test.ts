import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/matches'
import type { Matches } from '../api/matches'
import {
  SAVE_DELAY_MS,
  chooseMatch,
  forgetMatches,
  forgetServerGuesses,
  rememberMatches,
  resetServerMatches,
  useServerMatches,
} from './serverMatches'

vi.mock('../api/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getMatches: vi.fn(),
  saveMatches: vi.fn(),
  clearGuesses: vi.fn(),
}))

const getMatches = vi.mocked(api.getMatches)
const saveMatches = vi.mocked(api.saveMatches)
const clearGuesses = vi.mocked(api.clearGuesses)

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const USER = { type: 'movie', id: 1, source: 'user' } as const
const GUESS = { type: 'tv', id: 2, source: 'guess', version: 2 } as const

beforeEach(() => {
  vi.resetAllMocks()
  resetServerMatches()
  // The batched save waits SAVE_DELAY_MS: fake timers, advancing with the clock so waitFor still polls.
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

/** Runs the batched save that rememberMatches scheduled. */
const flushSave = () => act(() => vi.advanceTimersByTimeAsync(SAVE_DELAY_MS))

describe('useServerMatches', () => {
  it('loads the matches once for every screen', async () => {
    getMatches.mockResolvedValue({ [A]: USER })
    const first = renderHook(() => useServerMatches())
    const second = renderHook(() => useServerMatches())
    expect(first.result.current).toBeUndefined()
    await waitFor(() => expect(first.result.current).toEqual({ [A]: USER }))
    expect(second.result.current).toEqual({ [A]: USER })
    renderHook(() => useServerMatches())
    expect(getMatches).toHaveBeenCalledTimes(1)
  })

  it('goes on without them when the server doesn’t answer', async () => {
    getMatches.mockRejectedValue(new api.MatchesError(502))
    const { result } = renderHook(() => useServerMatches())
    await waitFor(() => expect(result.current).toEqual({}))
  })

  it('asks again a minute after the server didn’t answer', async () => {
    getMatches.mockRejectedValueOnce(new api.MatchesError(502)).mockResolvedValue({ [A]: USER })
    const first = renderHook(() => useServerMatches())
    await waitFor(() => expect(first.result.current).toEqual({}))
    renderHook(() => useServerMatches())
    expect(getMatches).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 61_000)
    const later = renderHook(() => useServerMatches())
    await waitFor(() => expect(later.result.current).toEqual({ [A]: USER }))
    expect(first.result.current).toEqual({ [A]: USER })
  })
})

describe('rememberMatches', () => {
  it('saves new matches in one batch and shows what the server answers', async () => {
    getMatches.mockResolvedValue({ [A]: USER })
    saveMatches.mockImplementation(async (changes) => ({ [A]: USER, ...(changes as Matches) }))
    const { result } = renderHook(() => useServerMatches())
    await waitFor(() => expect(result.current).toBeDefined())

    rememberMatches({ [A]: USER })
    rememberMatches({ [B]: GUESS })
    await flushSave()
    expect(result.current).toEqual({ [A]: USER, [B]: GUESS })
    expect(saveMatches).toHaveBeenCalledTimes(1)
    expect(saveMatches).toHaveBeenCalledWith({ [B]: GUESS })
  })

  it('tries each match once per page, even when the server fails', async () => {
    getMatches.mockResolvedValue({})
    saveMatches.mockRejectedValue(new api.MatchesError(500))
    const { result } = renderHook(() => useServerMatches())
    await waitFor(() => expect(result.current).toEqual({}))

    rememberMatches({ [B]: GUESS })
    await flushSave()
    expect(saveMatches).toHaveBeenCalledTimes(1)
    rememberMatches({ [B]: GUESS })
    await flushSave()
    expect(saveMatches).toHaveBeenCalledTimes(1)
    expect(result.current).toEqual({})
  })
})

describe('forgetServerGuesses', () => {
  it('shows what is left and lets guesses be saved again', async () => {
    getMatches.mockResolvedValue({ [A]: USER, [B]: GUESS })
    clearGuesses.mockResolvedValue({ [A]: USER })
    saveMatches.mockImplementation(async (changes) => ({ [A]: USER, ...(changes as Matches) }))
    const { result } = renderHook(() => useServerMatches())
    await waitFor(() => expect(result.current).toEqual({ [A]: USER, [B]: GUESS }))

    await act(() => forgetServerGuesses())
    expect(result.current).toEqual({ [A]: USER })

    rememberMatches({ [B]: GUESS })
    await flushSave()
    expect(result.current).toEqual({ [A]: USER, [B]: GUESS })
  })

  it('keeps the guesses when the server doesn’t answer', async () => {
    getMatches.mockResolvedValue({ [B]: GUESS })
    clearGuesses.mockRejectedValue(new api.MatchesError(502))
    const { result } = renderHook(() => useServerMatches())
    await waitFor(() => expect(result.current).toEqual({ [B]: GUESS }))
    await act(() => forgetServerGuesses())
    expect(result.current).toEqual({ [B]: GUESS })
  })
})

describe('forgetMatches', () => {
  it('forgets deleted torrents on the server and lets them be saved again if they come back', async () => {
    getMatches.mockResolvedValue({ [A]: USER, [B]: GUESS })
    saveMatches.mockImplementation(async (changes) =>
      Object.fromEntries(Object.entries({ [A]: USER, ...changes }).filter(([, match]) => match !== null)) as Matches,
    )
    const { result } = renderHook(() => useServerMatches())
    await waitFor(() => expect(result.current).toEqual({ [A]: USER, [B]: GUESS }))

    await act(() => forgetMatches([B]))
    expect(saveMatches).toHaveBeenCalledWith({ [B]: null })
    expect(result.current).toEqual({ [A]: USER })

    rememberMatches({ [B]: GUESS })
    await flushSave()
    expect(result.current).toEqual({ [A]: USER, [B]: GUESS })
  })

  it('drops a guess still waiting to be saved', async () => {
    getMatches.mockResolvedValue({})
    saveMatches.mockResolvedValue({})
    const { result } = renderHook(() => useServerMatches())
    await waitFor(() => expect(result.current).toEqual({}))

    rememberMatches({ [B]: GUESS })
    await act(() => forgetMatches([B]))
    await flushSave()
    expect(saveMatches).toHaveBeenCalledTimes(1)
    expect(saveMatches).toHaveBeenCalledWith({ [B]: null })
  })

  it('leaves the matches as they are when the server doesn’t answer', async () => {
    getMatches.mockResolvedValue({ [B]: GUESS })
    saveMatches.mockRejectedValue(new api.MatchesError(502))
    const { result } = renderHook(() => useServerMatches())
    await waitFor(() => expect(result.current).toEqual({ [B]: GUESS }))
    await act(() => forgetMatches([B]))
    expect(result.current).toEqual({ [B]: GUESS })
  })
})

describe('chooseMatch', () => {
  it('saves the user’s choice right away, over a guess still waiting to be saved', async () => {
    getMatches.mockResolvedValue({ [B]: GUESS })
    saveMatches.mockImplementation(async (changes) => ({ [B]: GUESS, ...(changes as Matches) }))
    const { result } = renderHook(() => useServerMatches())
    await waitFor(() => expect(result.current).toEqual({ [B]: GUESS }))

    rememberMatches({ [A]: { type: 'tv', id: 5, source: 'guess', version: 2 } })
    await act(() => chooseMatch(A, { type: 'movie', id: 1 }))
    expect(saveMatches).toHaveBeenCalledWith({ [A]: USER })
    expect(result.current).toEqual({ [B]: GUESS, [A]: USER })

    await flushSave()
    expect(saveMatches).toHaveBeenCalledTimes(1)
  })

  it('fails when the server doesn’t save it', async () => {
    saveMatches.mockRejectedValue(new api.MatchesError(500))
    await expect(chooseMatch(A, { type: 'movie', id: 1 })).rejects.toThrow()
  })
})
