import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Unreachable } from '../api/qbittorrent'
import { SettingsError } from '../api/settings'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { loadPastTheShell } from '../pwa/proxySignIn'
import { Preferences } from './Preferences'
import './ConnectScreen.css'

export interface ConnectScreenProps {
  /** Who didn't answer the session check: Kinopeer's server or qBittorrent. */
  unreachable?: Unreachable
  onRetry: () => void
  /** Rejects with a SettingsError saying why the server couldn't log in. */
  onSignIn: (username: string, password: string) => Promise<void>
}

/** A login refused, or who didn't answer it. */
type FormError = 'invalid' | 'banned' | Unreachable | null

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
      // An error the server named is its answer, so the server is there; without one there was no
      // answer, or not the server's (a sign-in proxy, Umbrel answering for a stopped app).
      else setError(code === undefined ? 'kinopeer' : 'qbittorrent')
      setSubmitting(false)
    }
  }

  const showUnreachable = error === 'kinopeer' || error === 'qbittorrent' ? error : unreachable

  return (
    <main className="screen connect">
      <form className="connect-form" onSubmit={handleSubmit}>
        <div className="connect-intro">
          <h1 className="t-h1">{t('connect.title')}</h1>
          <p className="t-body c2">{t('connect.body')}</p>
        </div>

        {showUnreachable && (
          <Banner
            tone="error"
            title={t('connect.unreachableTitle', { context: showUnreachable })}
            actionLabel={showUnreachable === 'kinopeer' ? t('common.openAgain') : t('common.retry')}
            onAction={showUnreachable === 'kinopeer' ? () => loadPastTheShell() : onRetry}
          >
            {t('connect.unreachableBody', { context: showUnreachable })}
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
