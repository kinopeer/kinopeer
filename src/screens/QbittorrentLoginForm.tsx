import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { failureOf, type ConnectionFailure } from '../api/connectionFailure'
import { unreachable, type Unreachable } from '../api/qbittorrent'
import { SettingsError } from '../api/settings'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { failureText } from '../lib/failureText'
import { unreachableText, useMayOpenAgain } from '../lib/unreachable'
import { loadPastTheShell } from '../pwa/proxySignIn'

export interface QbittorrentLoginFormProps {
  /** The form's layout: the connect screen's card, or a sheet's. */
  className: string
  /** Above the errors: the connect screen's title and text. */
  header?: ReactNode
  /** Under Connect: the connect screen's Change or Cancel. */
  actions?: ReactNode
  /** Ask for qBittorrent's address beside the login, which is optional then. */
  askAddress?: boolean
  /** What the address field starts with: the address saved from the app. */
  initialAddress?: string
  /** The address in use was saved from the app, not set on the server, which is what a wrong one is said to be. */
  addressFromApp?: boolean
  /** Rejects with a SettingsError saying why the server couldn't log in; `url` only when the form asked for an address. */
  onSubmit: (username: string, password: string, url?: string) => Promise<void>
  /** The environment set an address meanwhile, which wins over one sent from here. */
  onEnvAddress: () => void
  /** Retry beside who didn't answer; without it the banner only says so. */
  onRetry?: () => void
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
  | 'host-refused'
  | 'invalid-address'
  | 'address-unreachable'
  | 'auth-off'
  | 'storage'
  | Unreachable
  | null

/** Errors shown in the form itself rather than as who didn't answer. */
const FORM_ERRORS = new Set<FormError>(['invalid', 'login-needed', 'banned', 'not-qbittorrent', 'host-refused', 'invalid-address', 'address-unreachable', 'auth-off', 'storage'])

/**
 * qBittorrent's login, and its address where the app may set it: the server checks them together
 * and keeps them. The connect screen and Settings → Connections both use it.
 */
export function QbittorrentLoginForm({
  className,
  header,
  actions,
  askAddress,
  initialAddress = '',
  addressFromApp,
  onSubmit,
  onEnvAddress,
  onRetry,
}: QbittorrentLoginFormProps) {
  const { t } = useTranslation()
  const [address, setAddress] = useState(initialAddress)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<FormError>(null)
  // Why qBittorrent didn't answer the check, where the server could tell (#508).
  const [failure, setFailure] = useState<ConnectionFailure>()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // One check at a time: `loading` doesn't stop Enter in a field.
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await (askAddress ? onSubmit(username, password, address) : onSubmit(username, password))
    } catch (e) {
      setFailure(failureOf(e))
      const code = e instanceof SettingsError ? e.code : undefined
      if (code === 'invalid-credentials') setError(askAddress && !username.trim() ? 'login-needed' : 'invalid')
      else if (code === 'banned') setError('banned')
      else if (code === 'not-qbittorrent') setError('not-qbittorrent')
      else if (code === 'host-refused') setError('host-refused')
      else if (code === 'invalid-address') setError('invalid-address')
      // With an address sent, the server is there and says that address didn't answer.
      else if (code === 'unreachable' && askAddress) setError('address-unreachable')
      else if (code === 'auth-off') setError('auth-off')
      else if (code === 'storage') setError('storage')
      else if (code === 'env-address') onEnvAddress()
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
  const clearLoginError = () => {
    if (error === 'invalid' || error === 'login-needed') setError(null)
  }

  return (
    <form className={className} onSubmit={handleSubmit}>
      {header}

      {signInUnreachable && (
        <Banner
          tone="error"
          title={t('noAnswer.qbittorrent', { context: unreachableText(signInUnreachable) })}
          actionLabel={onRetry && t('common.retry')}
          onAction={onRetry}
          secondaryActionLabel={openAgain ? t('common.openAgain') : undefined}
          onSecondaryAction={() => loadPastTheShell()}
        >
          {/* A cause comes only with qBittorrent's no answer, which the server names. */}
          {failureText(t, 'qbittorrent', failure) ??
            t('connect.unreachableBody', { context: openAgain ? 'openAgain' : unreachableText(signInUnreachable) })}
        </Banner>
      )}
      {error === 'banned' && <Banner tone="error">{t('connect.banned')}</Banner>}
      {error === 'not-qbittorrent' && (
        // An address from the app, typed here or saved before, is checked here; the environment's on the server.
        <Banner tone="error">{t('connect.notQbittorrent', { context: askAddress || addressFromApp ? 'app' : undefined })}</Banner>
      )}
      {error === 'host-refused' && <Banner tone="error">{t('connect.hostRefused')}</Banner>}
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
            // type="url" turned iOS Safari's autocorrect off; a text field needs it said (#494).
            autoCorrect="off"
            spellCheck={false}
            mono
            required
            value={address}
            onChange={(e) => {
              setAddress(e.target.value)
              if (error === 'invalid-address' || error === 'address-unreachable') setError(null)
            }}
            error={(error === 'invalid-address' && t('address.invalid')) || (error === 'address-unreachable' && (failureText(t, 'qbittorrent', failure) ?? t('connect.addressUnreachable')))}
            help={t('connect.addressHelp')}
          />
        )}
        <Input
          label={t('connect.username')}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
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
      {actions}
    </form>
  )
}
