import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { unreachable, type Unreachable } from '../api/qbittorrent'
import { SERVER_SETTINGS_FRESH_MS, SERVER_SETTINGS_KEY, SettingsError, getServerSettings } from '../api/settings'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { unreachableText, useMayOpenAgain } from '../lib/unreachable'
import { useRequest } from '../lib/useRequest'
import { loadPastTheShell } from '../pwa/proxySignIn'
import { Preferences } from './Preferences'
import { UnreachableState } from './UnreachableState'
import './ConnectScreen.css'

export interface ConnectScreenProps {
  /** Who didn't answer the session check: shown in place of the form, with Retry. */
  unreachable?: Unreachable
  /** The server has no address for qBittorrent: the form asks for one, and a login only where qBittorrent wants one. */
  noAddress?: boolean
  onRetry: () => void
  /** Rejects with a SettingsError saying why the server couldn't log in; `url` only when the form asked for an address. */
  onSignIn: (username: string, password: string, url?: string) => Promise<void>
}

/**
 * A login refused (`login-needed` when none was sent), the address refused or not answering,
 * something at it that isn't qBittorrent, the server refusing an address with its own login off,
 * the server unable to write its settings, or who didn't answer.
 */
type FormError =
  | 'invalid'
  | 'login-needed'
  | 'banned'
  | 'not-qbittorrent'
  | 'invalid-address'
  | 'address-unreachable'
  | 'auth-off'
  | 'storage'
  | Unreachable
  | null

/** Errors shown in the form itself rather than as who didn't answer. */
const FORM_ERRORS = new Set<FormError>(['invalid', 'login-needed', 'banned', 'not-qbittorrent', 'invalid-address', 'address-unreachable', 'auth-off', 'storage'])

export function ConnectScreen({ unreachable: unreachableProp, noAddress = false, onRetry, onSignIn }: ConnectScreenProps) {
  const { t } = useTranslation()
  // Only an address saved from the app can be changed here, and only behind Kinopeer's own login:
  // the server refuses one otherwise. Not asked while the server itself doesn't answer.
  const settingsKey = noAddress || unreachableProp === 'unreached' || unreachableProp === 'kinopeer' ? null : SERVER_SETTINGS_KEY
  const settings = useRequest(settingsKey, (signal) => getServerSettings(signal), { freshFor: SERVER_SETTINGS_FRESH_MS }).data
  const saved = settings?.auth?.enabled && settings.qbittorrent.address.source === 'saved' ? settings.qbittorrent.address.url : undefined
  const [changing, setChanging] = useState(false)
  // Change shows only with an address saved from the app.
  const askAddress = noAddress || changing
  const [address, setAddress] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<FormError>(null)

  const changeAddress = (change: boolean) => {
    setAddress(saved ?? '')
    setError(null)
    setChanging(change)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await (askAddress ? onSignIn(username, password, address) : onSignIn(username, password))
    } catch (e) {
      const code = e instanceof SettingsError ? e.code : undefined
      if (code === 'invalid-credentials') setError(askAddress && !username.trim() ? 'login-needed' : 'invalid')
      else if (code === 'banned') setError('banned')
      else if (code === 'not-qbittorrent') setError('not-qbittorrent')
      else if (code === 'invalid-address') setError('invalid-address')
      // With an address sent, the server is there and says that address didn't answer.
      else if (code === 'unreachable' && askAddress) setError('address-unreachable')
      else if (code === 'auth-off') setError('auth-off')
      else if (code === 'storage') setError('storage')
      // The environment set an address meanwhile, which wins: check the session at it.
      else if (code === 'env-address') onRetry()
      // An error the server named is its answer, so the server is there; one without a name came
      // from something in front of it (Umbrel answering for a stopped app); no answer is unreached.
      else if (e instanceof SettingsError) setError(code === undefined ? 'kinopeer' : 'qbittorrent')
      else setError(unreachable(e))
      setSubmitting(false)
    }
  }

  // Who didn't answer the sign-in, shown over the form, so what was typed stays.
  const signInUnreachable = error === null || FORM_ERRORS.has(error) ? undefined : (error as Unreachable)
  const openAgain = useMayOpenAgain(signInUnreachable)
  const changeButton = saved !== undefined && !askAddress && (
    <Button type="button" variant="ghost" size="lg" block onClick={() => changeAddress(true)}>
      {t('connect.changeAddress')}
    </Button>
  )

  // The session check got no answer: no login form until there's someone to sign in to, but an
  // address saved from the app can be changed, since a wrong one is why qBittorrent doesn't answer.
  if (unreachableProp && !askAddress) {
    return (
      <main className="screen connect">
        <section className="connect-form connect-unreachable">
          <UnreachableState unreachable={unreachableProp} onRetry={onRetry} texts="connect" />
          {changeButton}
        </section>
        <Preferences />
      </main>
    )
  }

  const clearLoginError = () => {
    if (error === 'invalid' || error === 'login-needed') setError(null)
  }

  return (
    <main className="screen connect">
      <form className="connect-form" onSubmit={handleSubmit}>
        <div className="connect-intro">
          <h1 className="t-h1">{t('connect.title')}</h1>
          <p className="t-body c2">{t(askAddress ? 'connect.addressBody' : 'connect.body')}</p>
        </div>

        {signInUnreachable && (
          <Banner
            tone="error"
            title={t('noAnswer.qbittorrent', { context: unreachableText(signInUnreachable) })}
            actionLabel={t('common.retry')}
            onAction={onRetry}
            secondaryActionLabel={openAgain ? t('common.openAgain') : undefined}
            onSecondaryAction={() => loadPastTheShell()}
          >
            {t('connect.unreachableBody', { context: openAgain ? 'openAgain' : unreachableText(signInUnreachable) })}
          </Banner>
        )}
        {error === 'banned' && <Banner tone="error">{t('connect.banned')}</Banner>}
        {error === 'not-qbittorrent' && (
          // An address from the app, typed here or saved before, is checked here; the environment's on the server.
          <Banner tone="error">{t('connect.notQbittorrent', { context: askAddress || saved !== undefined ? 'app' : undefined })}</Banner>
        )}
        {error === 'auth-off' && <Banner tone="error">{t('connect.authOff')}</Banner>}
        {error === 'storage' && <Banner tone="error">{t('keyForm.storage')}</Banner>}

        <div className="connect-fields">
          {askAddress && (
            <Input
              label={t('connect.address')}
              name="url"
              // Text, not url: the browser would block an address without a scheme with a bubble of its
              // own, before the server's invalid-address could say what's missing.
              inputMode="url"
              autoComplete="url"
              autoCapitalize="none"
              spellCheck={false}
              mono
              required
              value={address}
              onChange={(e) => {
                setAddress(e.target.value)
                if (error === 'invalid-address' || error === 'address-unreachable') setError(null)
              }}
              error={
                (error === 'invalid-address' && t('address.invalid')) || (error === 'address-unreachable' && t('connect.addressUnreachable'))
              }
              help={t('connect.addressHelp')}
            />
          )}
          <Input
            label={t('connect.username')}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            // With an address, qBittorrent's auth bypass may let the server in without a login.
            required={!askAddress}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              clearLoginError()
            }}
            error={error === 'invalid' || error === 'login-needed'}
            help={askAddress ? t('connect.loginOptional') : undefined}
          />
          <Input
            label={t('connect.password')}
            name="password"
            type="password"
            autoComplete="current-password"
            required={!askAddress}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              clearLoginError()
            }}
            error={(error === 'invalid' && t('connect.invalidCredentials')) || (error === 'login-needed' && t('connect.loginNeeded'))}
          />
        </div>

        <Button type="submit" size="lg" block loading={submitting}>
          {t('connect.submit')}
        </Button>
        {changeButton}
        {changing && (
          <Button type="button" variant="ghost" size="lg" block onClick={() => changeAddress(false)}>
            {t('common.cancel')}
          </Button>
        )}
      </form>
      <Preferences />
    </main>
  )
}
