import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthError, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, setSignInNeed, setUpPassword, signIn, type SignInNeed } from '../api/auth'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Preferences } from './Preferences'
import { throttledText } from '../logic/throttledText'

export interface SignInScreenProps {
  /** Set the first password, or sign in with the one there is. */
  need: SignInNeed
}

/** Why the password wasn't taken. */
type FormError = 'invalid' | 'too-short' | 'too-long' | 'mismatch' | 'already-set' | 'throttled' | 'storage' | 'failed' | null

/** The name a password manager saves Kinopeer's password under, from the hidden username field. */
const ACCOUNT_NAME = 'Kinopeer'

/**
 * Kinopeer's own login (server/auth.ts), in place of the whole app until it lets the browser in:
 * setting the first password on a server that has none, or signing in. Either clears the page's
 * `signInNeed`, which brings the app back.
 */
export function SignInScreen({ need }: SignInScreenProps) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<FormError>(null)
  const [waitMs, setWaitMs] = useState(0)
  const settingUp = need === 'set-up'

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    if (settingUp && password.length < MIN_PASSWORD_LENGTH) return setError('too-short')
    if (settingUp && password.length > MAX_PASSWORD_LENGTH) return setError('too-long')
    if (settingUp && repeat !== password) return setError('mismatch')
    // Longer than any password the server takes, so not its password.
    if (!settingUp && password.length > MAX_PASSWORD_LENGTH) return setError('invalid')
    setSubmitting(true)
    setError(null)
    try {
      await (settingUp ? setUpPassword(password) : signIn(password))
    } catch (e) {
      const code = e instanceof AuthError ? e.code : undefined
      setSubmitting(false)
      setWaitMs(e instanceof AuthError ? (e.retryAfterMs ?? 0) : 0)
      if (code === 'already-set') {
        // Someone else set it first: what's left is to sign in with theirs.
        setPassword('')
        setRepeat('')
        setError('already-set')
        setSignInNeed('sign-in')
      } else if (code === 'not-set-up') {
        // The password was reset on the server since this screen opened: what's left is to set one.
        setPassword('')
        setError(null)
        setSignInNeed('set-up')
      } else if (code === 'invalid-password') setError('invalid')
      else if (code === 'too-short' || code === 'throttled' || code === 'storage') setError(code)
      else setError('failed')
    }
  }

  const clearFieldError = () => {
    if (error === 'invalid' || error === 'too-short' || error === 'too-long' || error === 'mismatch') setError(null)
  }

  return (
    <main className="screen connect">
      <form className="connect-form" onSubmit={handleSubmit} noValidate={settingUp}>
        <div className="connect-intro">
          <h1 className="t-h1">{t(settingUp ? 'signIn.setUpTitle' : 'signIn.title')}</h1>
          <p className="t-body c2">{t(settingUp ? 'signIn.setUpBody' : 'signIn.body')}</p>
        </div>

        {error === 'already-set' && <Banner tone="warning">{t('signIn.alreadySet')}</Banner>}
        {(error === 'throttled' || (error === 'invalid' && waitMs > 0)) && (
          <Banner tone="error">{throttledText(t, waitMs)}</Banner>
        )}
        {error === 'storage' && <Banner tone="error">{t('keyForm.storage')}</Banner>}
        {error === 'failed' && <Banner tone="error">{t('common.qbtFailed_kinopeer')}</Banner>}

        <div className="connect-fields">
          {/* For password managers, which save a password under a username. */}
          <input
            className="sr-only"
            type="text"
            name="username"
            autoComplete="username"
            value={ACCOUNT_NAME}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
          />
          <Input
            label={t(settingUp ? 'signIn.newPassword' : 'connect.password')}
            name="password"
            type="password"
            autoComplete={settingUp ? 'new-password' : 'current-password'}
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              clearFieldError()
            }}
            help={settingUp ? t('signIn.passwordHelp', { count: MIN_PASSWORD_LENGTH }) : undefined}
            error={
              error === 'invalid'
                ? t('signIn.invalid')
                : error === 'too-short'
                  ? t('signIn.passwordHelp', { count: MIN_PASSWORD_LENGTH })
                  : error === 'too-long' && t('signIn.passwordTooLong', { count: MAX_PASSWORD_LENGTH })
            }
          />
          {settingUp && (
            <Input
              label={t('signIn.repeatPassword')}
              name="repeat-password"
              type="password"
              autoComplete="new-password"
              required
              value={repeat}
              onChange={(event) => {
                setRepeat(event.target.value)
                clearFieldError()
              }}
              error={error === 'mismatch' && t('signIn.mismatch')}
            />
          )}
        </div>

        <Button type="submit" size="lg" block loading={submitting}>
          {t(settingUp ? 'signIn.setUp' : 'signIn.submit')}
        </Button>
      </form>
      <Preferences />
    </main>
  )
}
