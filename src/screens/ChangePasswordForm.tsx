import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthError, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, changePassword } from '../api/auth'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { throttledText } from '../logic/throttledText'

export interface ChangePasswordFormProps {
  /** The server took the new password; this browser stays signed in. */
  onChanged: () => void
}

type FormError = 'no-current' | 'invalid' | 'too-short' | 'too-long' | 'mismatch' | 'throttled' | 'storage' | 'env-password' | 'failed' | null

/** Changes Kinopeer's own password, in a sheet from Settings; every other device is signed out. */
export function ChangePasswordForm({ onChanged }: ChangePasswordFormProps) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<FormError>(null)
  const [waitMs, setWaitMs] = useState(0)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    // The last wait was the server's answer to the last try; a refusal here is no try.
    setWaitMs(0)
    if (!current) return setError('no-current')
    if (password.length < MIN_PASSWORD_LENGTH) return setError('too-short')
    if (password.length > MAX_PASSWORD_LENGTH) return setError('too-long')
    if (repeat !== password) return setError('mismatch')
    // Longer than any password the server takes, so not the current one.
    if (current.length > MAX_PASSWORD_LENGTH) return setError('invalid')
    setSubmitting(true)
    setError(null)
    try {
      await changePassword(current, password)
      onChanged()
    } catch (e) {
      const code = e instanceof AuthError ? e.code : undefined
      setSubmitting(false)
      setWaitMs(e instanceof AuthError ? (e.retryAfterMs ?? 0) : 0)
      if (code === 'invalid-password') setError('invalid')
      else if (code === 'too-short' || code === 'throttled' || code === 'storage' || code === 'env-password') setError(code)
      else setError('failed')
    }
  }

  const fieldChanged = () => {
    if (error === 'no-current' || error === 'invalid' || error === 'too-short' || error === 'too-long' || error === 'mismatch') setError(null)
  }

  return (
    <form className="key-form" onSubmit={handleSubmit} noValidate>
      {(error === 'throttled' || (error === 'invalid' && waitMs > 0)) && <Banner tone="error">{throttledText(t, waitMs)}</Banner>}
      {error === 'storage' && <Banner tone="error">{t('keyForm.storage')}</Banner>}
      {/* KINOPEER_PASSWORD set since Settings showed the form. */}
      {error === 'env-password' && <Banner tone="error">{t('settings.passwordFromEnv')}</Banner>}
      {error === 'failed' && <Banner tone="error">{t('settings.changePasswordFailed')}</Banner>}

      <Input
        label={t('settings.currentPassword')}
        name="current-password"
        type="password"
        autoComplete="current-password"
        required
        value={current}
        onChange={(event) => {
          setCurrent(event.target.value)
          fieldChanged()
        }}
        error={(error === 'no-current' && t('settings.currentPasswordMissing')) || (error === 'invalid' && t('signIn.invalid'))}
      />
      <Input
        label={t('signIn.newPassword')}
        name="new-password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => {
          setPassword(event.target.value)
          fieldChanged()
        }}
        help={t('signIn.passwordHelp', { count: MIN_PASSWORD_LENGTH })}
        error={
          error === 'too-short'
            ? t('signIn.passwordHelp', { count: MIN_PASSWORD_LENGTH })
            : error === 'too-long' && t('signIn.passwordTooLong', { count: MAX_PASSWORD_LENGTH })
        }
      />
      <Input
        label={t('signIn.repeatPassword')}
        name="repeat-password"
        type="password"
        autoComplete="new-password"
        required
        value={repeat}
        onChange={(event) => {
          setRepeat(event.target.value)
          fieldChanged()
        }}
        error={error === 'mismatch' && t('signIn.mismatch')}
      />

      <div className="key-form-actions">
        <Button type="submit" size="lg" block loading={submitting}>
          {t('settings.changePassword')}
        </Button>
      </div>
    </form>
  )
}
