import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsError } from '../api/settings'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Preferences } from './Preferences'

export interface ConnectScreenProps {
  /** qBittorrent did not answer the session check. */
  unreachable?: boolean
  onRetry: () => void
  /** Rejects with a SettingsError saying why the server couldn't log in. */
  onSignIn: (username: string, password: string) => Promise<void>
}

type FormError = 'invalid' | 'banned' | 'unreachable' | null

export function ConnectScreen({ unreachable, onRetry, onSignIn }: ConnectScreenProps) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<FormError>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onSignIn(username, password)
    } catch (e) {
      const code = e instanceof SettingsError ? e.code : undefined
      if (code === 'invalid-credentials') setError('invalid')
      else if (code === 'banned') setError('banned')
      else setError('unreachable')
      setSubmitting(false)
    }
  }

  const showUnreachable = unreachable || error === 'unreachable'

  return (
    <main className="screen connect">
      <form className="connect-form" onSubmit={handleSubmit}>
        <div className="connect-intro">
          <h1 className="t-h1">{t('connect.title')}</h1>
          <p className="t-body c2">{t('connect.body')}</p>
        </div>

        {showUnreachable && (
          <Banner tone="error" title={t('connect.unreachableTitle')} actionLabel={t('common.retry')} onAction={onRetry}>
            {t('connect.unreachableBody')}
          </Banner>
        )}
        {error === 'banned' && <Banner tone="error">{t('connect.banned')}</Banner>}

        <div className="connect-fields">
          <Input
            label={t('connect.username')}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              if (error === 'invalid') setError(null)
            }}
            error={error === 'invalid'}
          />
          <Input
            label={t('connect.password')}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (error === 'invalid') setError(null)
            }}
            error={error === 'invalid' && t('connect.invalidCredentials')}
          />
        </div>

        <Button type="submit" size="lg" block loading={submitting}>
          {t('connect.submit')}
        </Button>
      </form>
      <Preferences />
    </main>
  )
}
