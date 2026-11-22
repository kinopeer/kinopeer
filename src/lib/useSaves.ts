import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { saveKey, saves, type SaveOutcome, type SaveSettled } from '../logic/saves'

export type { SaveOutcome, SaveSettled } from '../logic/saves'

export interface SavesOfKind<Payload> {
  /** What's being sent for a target, while it is, from any sheet: a sheet for it shows it busy. */
  pending: (target: string) => Payload | undefined
  /**
   * Sends a save for a target, which outlives the sheet, and says how it settled and whether a sheet
   * took the outcome; nothing when one is already in flight for it.
   */
  send: <Result>(target: string, payload: Payload, request: () => Promise<Result>) => Promise<SaveSettled<Result> | undefined>
}

/**
 * A sheet's saves of one kind (`saves`): what's in flight for each target, shown on every render,
 * and sending one. While the sheet is here, `takes` is offered the outcome of each save of the kind
 * as it settles, whichever sheet sent it, and says whether it took it (it shows the target); a sheet
 * that's gone takes nothing, so its caller says the outcome elsewhere. The latest render's `takes`
 * is the one asked.
 */
export function useSaves<Payload>(
  kind: string,
  takes: (outcome: SaveOutcome, sent: Payload, target: string) => boolean,
): SavesOfKind<Payload> {
  const inFlight = useSyncExternalStore(saves.subscribe, saves.getSnapshot)
  const latest = useRef(takes)
  useLayoutEffect(() => {
    latest.current = takes
  })
  useEffect(() => saves.watch(kind, { settled: (outcome, sent, target) => latest.current(outcome, sent as Payload, target) }), [kind])

  const pending = (target: string) => inFlight.get(saveKey(kind, target)) as Payload | undefined
  const send = useCallback(
    <Result,>(target: string, payload: Payload, request: () => Promise<Result>) => saves.send(kind, target, payload, request),
    [kind],
  )
  return { pending, send }
}
