import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PushError } from '../api/push'
import type { NotifyLanguage } from '../api/settings/types'
import { useToast } from '../components/Toast'
import { useSaves, type SaveOutcome } from '../lib/useSaves'
import { isForgotten, pushState, testPushDevice, turnOffPush, turnOnPush, type PushState } from '../pwa/push'

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

type Action = NonNullable<PushCard['busy']>

/** The device's actions (`useSaves`): one target, since each changes or reads its one subscription. */
const PUSH_SAVES = 'push'
const DEVICE = 'device'

/**
 * This device's push notifications in Settings (`src/pwa/push.ts`): read from the browser when the
 * card shows, asking the server nothing; turned on, tested and turned off from it. An action goes on
 * once Settings is left: the card shown again shows it on its way and what it did, else a toast does.
 */
export function usePushDevice(language: NotifyLanguage): PushCard {
  const { t } = useTranslation()
  const toast = useToast()
  const [state, setState] = useState<PushState | null>(null)
  const [outcome, setOutcome] = useState<PushCard['outcome']>(null)
  // A state set after Settings closed is dropped by React. What an action settled meanwhile is newer
  // than what the browser said as the card showed.
  useEffect(() => {
    pushState().then(
      (read) => setState((now) => now ?? read),
      () => setState((now) => now ?? { kind: 'unsupported' }),
    )
  }, [])

  /**
   * What a failure says: the server's code, the server answering with another error, Kinopeer not
   * answering (no answer, or one without the server's code, as a proxy's page), or the browser's refusal.
   */
  const failure = (error: unknown): string => {
    if (!(error instanceof PushError)) return error instanceof DOMException ? t('push.browserFailed') : t('noAnswer.qbittorrent_kinopeer')
    if (error.code === 'invalid-endpoint') return t('push.invalidEndpoint')
    if (error.code === 'refused') return t('push.refused')
    if (error.code === 'unreachable') return t('push.unreachable')
    if (error.code === 'storage') return t('keyForm.storage')
    return error.code ? t('push.serverError') : t('noAnswer.qbittorrent_kinopeer')
  }

  /** What an action did, for the card or a toast: the device's state after it, and what to say. */
  const result = (kind: Action, settled: SaveOutcome): { next?: PushState; said: PushCard['outcome'] } => {
    if (settled.ok) {
      const next = settled.result as PushState | undefined
      return { next, said: kind === 'on' ? null : { ok: true, message: t(kind === 'test' ? 'push.testSent' : 'push.turnedOff') } }
    }
    // The server forgot this device: it's off, and says why.
    if (isForgotten(settled.error)) return { next: { kind: 'off' }, said: { ok: false, message: t('push.forgotten') } }
    return { said: { ok: false, message: failure(settled.error) } }
  }

  // Shown, the card takes every action's outcome, whichever card sent it.
  const saving = useSaves<Action>(PUSH_SAVES, (settled, kind) => {
    const { next, said } = result(kind, settled)
    if (next) setState(next)
    setOutcome(said)
    return true
  })
  // One action at a time, from this card or one shown before it: the buttons are disabled meanwhile.
  const busy = saving.pending(DEVICE) ?? null

  const run = async (kind: Action, action: () => Promise<PushState | void>) => {
    setOutcome(null)
    const settled = await saving.send(DEVICE, kind, action)
    // Settings left meanwhile: a toast says what the card would have, naming push where the card's text doesn't.
    if (!settled || settled.taken) return
    const { next, said } = result(kind, settled)
    if (said) toast.show(said.ok ? said.message : t('push.failedNamed', { reason: said.message }), { icon: said.ok ? 'check' : 'alert' })
    else if (next?.kind === 'on') toast.show(t('push.turnedOn'), { icon: 'check' })
    else if (next?.kind === 'denied') toast.show(t('push.denied'), { icon: 'alert' })
  }

  const endpoint = state?.kind === 'on' ? state.endpoint : ''
  return {
    state,
    busy,
    outcome,
    turnOn: () => void run('on', () => turnOnPush(language)),
    test: () => void run('test', () => testPushDevice(endpoint)),
    turnOff: () => void run('off', () => turnOffPush(endpoint)),
  }
}
