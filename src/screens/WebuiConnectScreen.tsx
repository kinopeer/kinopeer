import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { QbittorrentError, type Unreachable } from '../api/qbittorrent'
import { logIn } from '../api/qbittorrent/webui'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Preferences } from './Preferences'
import { UnreachableState } from './UnreachableState'
import { UnsupportedQbittorrent } from './UnsupportedQbittorrent'

export interface WebuiConnectScreenProps {
  /**
   * Who didn't answer the session check: shown in place of the form, with Retry. Always qBittorrent
   * here, and with no cause, which only Kinopeer's bridge can tell.
   */
  unreachable?: Unreachable
  /** The version of a qBittorrent older than the WebUI build works with: said in place of the form. */
  unsupported?: string
  /** Checks the session again: Retry, and what a login that went through does next. */
  onRetry: () => void
}

/**
 * The WebUI build's connect screen, where qBittorrent itself serves Kinopeer: its own login, which
 * the browser keeps a session of (`logIn`), and nothing about an address or Kinopeer's server, which
 * this build has none of. Shown again when qBittorrent's session ends (an hour unused by default).
 */
export function WebuiConnectScreen({ unreachable, unsupported, onRetry }: WebuiConnectScreenProps) {
  const notice =
    unsupported !== undefined ? (
      <UnsupportedQbittorrent version={unsupported} onRetry={onRetry} />
    ) : (
      unreachable && <UnreachableState unreachable={unreachable} onRetry={onRetry} texts="connect" />
    )
  return (
    <main className="screen connect">
      {notice ? <section className="connect-form connect-unreachable">{notice}</section> : <QbittorrentSignInForm onSignedIn={onRetry} />}
      <Preferences />
    </main>
  )
}

/** Why qBittorrent didn't let the browser in: the login, the address banned, no answer, or another refusal. */
type FormError = 'invalid' | 'banned' | 'unreachable' | 'failed' | null

/**
 * qBittorrent's login, sent from the browser: a real form with a username and a current password,
 * so the browser's password manager offers and saves them.
 */
function QbittorrentSignInForm({ onSignedIn }: { onSignedIn: () => void }) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<FormError>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // `loading` doesn't stop Enter in a field.
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await logIn(username, password)
      if (result === 'ok') return onSignedIn()
      setError(result)
    } catch (e) {
      // qBittorrent refusing in some other way, else nothing answered (fetch's TypeError, or the login's time limit).
      setError(e instanceof QbittorrentError ? 'failed' : 'unreachable')
    }
    setSubmitting(false)
  }

  const clearLoginError = () => {
    if (error === 'invalid') setError(null)
  }

  return (
    <form className="connect-form" onSubmit={handleSubmit}>
      <div className="connect-intro">
        <h1 className="t-h1">{t('webui.signInTitle')}</h1>
        <p className="t-body c2">{t('webui.signInBody')}</p>
      </div>

      {error === 'banned' && <Banner tone="error">{t('connect.banned')}</Banner>}
      {error === 'unreachable' && (
        <Banner tone="error" title={t('noAnswer.qbittorrent')}>
          {t('connect.unreachableBody')}
        </Banner>
      )}
      {error === 'failed' && <Banner tone="error">{t('webui.signInFailed')}</Banner>}

      <div className="connect-fields">
        <Input
          label={t('connect.username')}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
            clearLoginError()
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
            clearLoginError()
          }}
          error={error === 'invalid' && t('connect.invalidCredentials')}
        />
      </div>

      <Button type="submit" size="lg" block loading={submitting}>
        {t('signIn.submit')}
      </Button>
    </form>
  )
}
