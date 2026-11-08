import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { cx } from '../lib/cx'
import './MatchPrompt.css'

export interface MatchPromptProps {
  /** `guess`: the title was guessed from the release name. `none`: no title was found for it. */
  kind: 'guess' | 'none'
  /** Saving the confirmation. */
  busy?: boolean
  /** Nothing can be chosen now (the torrent is being deleted). */
  disabled?: boolean
  /** Opens the title search. */
  onChange: () => void
  /** Keeps the guessed title as the user's choice. */
  onConfirm?: () => void
  className?: string
}

/** Asks the user to check a title guessed from the release name, or to pick one when none was found. */
export function MatchPrompt({ kind, busy, disabled, onChange, onConfirm, className }: MatchPromptProps) {
  const { t } = useTranslation()
  return (
    <div className={cx('match-prompt', className)}>
      <p className="t-cap c2 match-prompt-text">
        <Icon name={kind === 'guess' ? 'info' : 'film'} size={20} />
        <span>{kind === 'guess' ? t('match.guessNote') : t('match.noTitle')}</span>
      </p>
      {kind === 'guess' ? (
        <div className="match-prompt-actions">
          <Button variant="secondary" icon="search" block disabled={busy || disabled} onClick={onChange}>
            {t('common.change')}
          </Button>
          <Button variant="primary" icon="check" block loading={busy} disabled={busy || disabled} onClick={onConfirm}>
            {t('match.confirm')}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" icon="search" block disabled={disabled} onClick={onChange}>
          {t('match.pickTitle')}
        </Button>
      )}
    </div>
  )
}
