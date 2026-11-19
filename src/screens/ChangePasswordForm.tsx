import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthError, MIN_PASSWORD_LENGTH, changePassword } from '../api/auth'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { throttledText } from './throttledText'

export interface ChangePasswordFormProps {
  /** The server took the new password; this browser stays signed in. */
  onChanged: () => void
}

type FormError = 'invalid' | 'too-short' | 'mismatch' | 'throttled' | 'storage' | 'failed' | null

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
    if (password.length < MIN_PASSWORD_LENGTH) return setError('too-short')
    if (repeat !== password) return setError('mismatch')
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
      else if (code === 'too-short' || code === 'throttled' || code === 'storage') setError(code)
      else setError('failed')
    }
  }

  const fieldChanged = () => {
    if (error === 'invalid' || error === 'too-short' || error === 'mismatch') setError(null)
  }

  return (
    <form className="key-form" onSubmit={handleSubmit} noValidate>
      {(error === 'throttled' || (error === 'invalid' && waitMs > 0)) && <Banner tone="error">{throttledText(t, waitMs)}</Banner>}
      {error === 'storage' && <Banner tone="error">{t('keyForm.storage')}</Banner>}
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
        error={error === 'invalid' && t('signIn.invalid')}
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
        error={error === 'too-short' && t('signIn.passwordHelp', { count: MIN_PASSWORD_LENGTH })}
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
