import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PushError, testPush } from '../api/push'
import type { NotifyLanguage } from '../api/settings/types'
import { pushState, turnOffPush, turnOnPush, type PushState } from '../pwa/push'

/** What the push card says: still reading or busy, what it is, or what went wrong. */
export interface PushCard {
  /** null while the browser is read. */
  state: PushState | null
  busy: 'on' | 'test' | 'off' | null
  /** What the last action did, as text: the test sent, or why it failed. */
  outcome: { ok: boolean; message: string } | null
  turnOn: () => void
  test: () => void
  turnOff: () => void
}

/**
 * This device's push notifications in Settings (`src/pwa/push.ts`): read from the browser when the
 * card shows, asking the server nothing; turned on, tested and turned off from it.
 */
export function usePushDevice(language: NotifyLanguage): PushCard {
  const { t } = useTranslation()
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState<PushCard['busy']>(null)
  const [outcome, setOutcome] = useState<PushCard['outcome']>(null)
  // A state set after Settings closed is dropped by React; nothing else outlives the card.
  useEffect(() => {
    pushState().then(setState, () => setState({ kind: 'unsupported' }))
  }, [])

  /** What a failure says: the server's code, Kinopeer not answering, or the browser's refusal. */
  const failure = (error: unknown): string => {
    if (!(error instanceof PushError)) return error instanceof DOMException ? t('push.browserFailed') : t('noAnswer.qbittorrent_kinopeer')
    if (error.code === 'invalid-endpoint') return t('push.invalidEndpoint')
    if (error.code === 'refused') return t('push.refused')
    if (error.code === 'unreachable') return t('push.unreachable')
    return t('noAnswer.qbittorrent_kinopeer')
  }

  const run = (kind: NonNullable<PushCard['busy']>, action: () => Promise<PushState | void>, done?: string) => {
    if (busy) return
    setBusy(kind)
    setOutcome(null)
    action().then(
      (next) => {
        if (next) setState(next)
        if (done) setOutcome({ ok: true, message: done })
      },
      (error: unknown) => {
        // The server forgot this device: it's off, and says why.
        if (error instanceof PushError && (error.code === 'unknown-device' || error.code === 'gone')) {
          setState({ kind: 'off' })
          setOutcome({ ok: false, message: t('push.forgotten') })
        } else setOutcome({ ok: false, message: failure(error) })
      },
    ).finally(() => setBusy(null))
  }

  const endpoint = state?.kind === 'on' ? state.endpoint : ''
  return {
    state,
    busy,
    outcome,
    turnOn: () => run('on', () => turnOnPush(language)),
    test: () => run('test', () => testPush(endpoint), t('push.testSent')),
    turnOff: () => run('off', () => turnOffPush(endpoint), t('push.turnedOff')),
  }
}
