import { useCallback, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Toast } from '../components/Toast'
import { MoveOutcomeContext, type MoveOutcome } from './moveOutcome'

/** The toast with how a move went. */
export function MoveOutcomeToast({ outcome, onDismiss }: { outcome: MoveOutcome; onDismiss: () => void }) {
  const { t } = useTranslation()
  return (
    <Toast
      icon={'moved' in outcome ? 'folder' : 'alert'}
      message={'moved' in outcome ? t('move.moved', { location: outcome.moved }) : t(outcome.failed)}
      onDismiss={onDismiss}
    />
  )
}

/** Shows how a move went when the screen under it that started the move is gone by then. */
export function MoveOutcomeProvider({ children }: { children: ReactNode }) {
  const [outcome, setOutcome] = useState<MoveOutcome | null>(null)
  const dismiss = useCallback(() => setOutcome(null), [])
  return (
    <MoveOutcomeContext value={setOutcome}>
      {children}
      {outcome && <MoveOutcomeToast outcome={outcome} onDismiss={dismiss} />}
    </MoveOutcomeContext>
  )
}
