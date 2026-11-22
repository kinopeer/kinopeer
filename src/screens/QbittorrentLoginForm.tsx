import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { failureOf, type ConnectionFailure } from '../api/connectionFailure'
import { unreachable, type Unreachable } from '../api/qbittorrent'
import { SettingsError, type ServerSettings, type SourceAddress } from '../api/settings'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { useToast } from '../components/Toast'
import { failureText } from '../lib/failureText'
import { unreachableText, useMayOpenAgain } from '../lib/unreachable'
import { useSaves } from '../lib/useSaves'
import { loadPastTheShell } from '../pwa/proxySignIn'
import { BypassHint, LocalhostHint } from './ContainerHints'
import { FindAddress } from './FindAddress'

export interface QbittorrentLoginFormProps {
  /** The form's layout: the connect screen's card, or a sheet's. */
  className: string
  /** Above the errors: the connect screen's title and text. */
  header?: ReactNode
  /** Under Connect: the connect screen's Change or Cancel. */
  actions?: ReactNode
  /** Ask for qBittorrent's address beside the login. */
  askAddress?: boolean
  /** What the address field starts with: the address saved from the app. */
  initialAddress?: string
  /** The address in use was saved from the app, not set on the server, which is what a wrong one is said to be. */
  addressFromApp?: boolean
  /** Rejects with a SettingsError saying why the server couldn't log in; `url` only when the form asked for an address. */
  onSubmit: (username: string, password: string, url?: string) => Promise<ServerSettings>
  /**
   * The check passed, with the settings it answered: what the caller does next. The form open as it
   * settles calls it, one opened again by another caller included, else the form that sent it.
   */
  onSaved?: (settings: ServerSettings) => void
  /** The environment set an address meanwhile, which wins over one sent from here. */
  onEnvAddress: () => void
  /** Retry beside who didn't answer; without it the banner only says so. */
  onRetry?: () => void
  /**
   * Where qBittorrent sees Kinopeer come from, when it asked the session check for a login (#509),
   * shown until the form's own check answers. Not for a form that asks for another address.
   */
  source?: SourceAddress
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

/** Errors the form says in a banner; the rest are on a field, or who didn't answer. */
const BANNER_ERRORS = new Set<FormError>(['banned', 'not-qbittorrent', 'host-refused', 'auth-off', 'storage'])

/** The connection's save (`useSaves`), with what was typed but the password. */
const QBITTORRENT_SAVES = 'qbittorrent'
const CONNECTION = 'connection'
interface Sent {
  username: string
  url?: string
}

/** What a refused check says, by what was sent; the environment's address is the caller's to say. */
function errorOf(e: unknown, sent: Sent): FormError | 'env-address' {
  const code = e instanceof SettingsError ? e.code : undefined
  if (code === 'invalid-credentials') return sent.username.trim() ? 'invalid' : 'login-needed'
  if (code === 'env-address' || (code && FORM_ERRORS.has(code as FormError))) return code as FormError
  // With an address sent, the server is there and says that address didn't answer.
  if (code === 'unreachable' && sent.url !== undefined) return 'address-unreachable'
  // An error the server named is its answer, so the server is there; one without a name came
  // from something in front of it (Umbrel answering for a stopped app); no answer is unreached.
  if (e instanceof SettingsError) return code === undefined ? 'kinopeer' : 'qbittorrent'
  return unreachable(e)
}

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
  onSaved,
  onEnvAddress,
  onRetry,
  source: sessionSource,
}: QbittorrentLoginFormProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const [error, setError] = useState<FormError>(null)
  // Why qBittorrent didn't answer the check, where the server could tell (#508).
  const [failure, setFailure] = useState<ConnectionFailure>()
  // The server's hints for Kinopeer in a container (#509), from the last check.
  const [localhost, setLocalhost] = useState<SettingsError['container']>()
  // Once the server has answered a check, only its source: the session's was for a check before it.
  const [checkSource, setCheckSource] = useState<{ source?: SourceAddress }>()
  const source = checkSource ? checkSource.source : sessionSource

  function fail(e: unknown, sent: Sent) {
    setFailure(failureOf(e))
    setLocalhost(e instanceof SettingsError ? e.container : undefined)
    // A failure no check answered (no answer, a sign-in proxy) says nothing of the bypass.
    if (e instanceof SettingsError && e.code !== undefined) setCheckSource({ source: e.source })
    const failed = errorOf(e, sent)
    if (failed === 'env-address') onEnvAddress()
    else setError(failed)
  }

  // Open, the form takes every save, for its caller to follow, and every failure it can show: one that
  // asks for no address (the connect screen's Cancel) can't show what refused one.
  const saving = useSaves<Sent>(QBITTORRENT_SAVES, (outcome, sent) => {
    if (outcome.ok) onSaved?.(outcome.result as ServerSettings)
    else if (sent.url !== undefined && !askAddress) return false
    else fail(outcome.error, sent)
    return true
  })
  // One check at a time, from this form or one opened before it, which this one starts from.
  const sending = saving.pending(CONNECTION)
  const [address, setAddress] = useState(sending?.url ?? initialAddress)
  const [username, setUsername] = useState(sending?.username ?? '')
  const [password, setPassword] = useState('')

  /**
   * What a failure says, on its field or in a banner, or in a toast once the form is gone (`named`,
   * which names what failed where a field would): one wording per failure for both. `sentAddress`: the
   * check was of an address from the app.
   */
  function errorText(failed: FormError, why?: string, sentAddress?: boolean, named?: boolean): string {
    if (failed === 'invalid') return t(named ? 'connect.loginRefused' : 'connect.invalidCredentials')
    if (failed === 'login-needed') return t('connect.loginNeeded')
    if (failed === 'banned') return t('connect.banned')
    // An address from the app, typed here or saved before, is checked here; the environment's on the server.
    if (failed === 'not-qbittorrent') return t('connect.notQbittorrent', { context: sentAddress || addressFromApp ? 'app' : undefined })
    if (failed === 'host-refused') return t('connect.hostRefused')
    if (failed === 'auth-off') return t('connect.authOff')
    if (failed === 'storage') return t('keyForm.storage')
    if (failed === 'invalid-address') return t('address.invalid')
    // Why nothing answered, at the address sent or the server's, where the server could tell (#508).
    if (why) return why
    if (failed === 'address-unreachable') return t('connect.addressUnreachable')
    // Else that it failed, which trying again may change.
    return t('connect.saveFailed')
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // Nothing goes while a check is on its way, and what it shows stays: `loading` doesn't stop Enter in a field.
    if (sending) return
    setError(null)
    const sent = { username, url: askAddress ? address : undefined }
    const settled = await saving.send(CONNECTION, sent, () => (askAddress ? onSubmit(username, password, address) : onSubmit(username, password)))
    // No form took it: the caller still follows a save, and the environment's address; a failure is
    // said in a toast.
    if (!settled || settled.taken) return
    if (settled.ok) onSaved?.(settled.result)
    else if (errorOf(settled.error, sent) === 'env-address') onEnvAddress()
    else toast.show(errorText(errorOf(settled.error, sent) as FormError, failureText(t, 'qbittorrent', failureOf(settled.error)), sent.url !== undefined, true), { icon: 'alert' })
  }

  // Who didn't answer the sign-in, shown over the form, so what was typed stays.
  const signInUnreachable = error === null || FORM_ERRORS.has(error) ? undefined : (error as Unreachable)
  const openAgain = useMayOpenAgain(signInUnreachable)
  const changeAddress = (value: string) => {
    setAddress(value)
    // The hint was for the address checked.
    setLocalhost(undefined)
    if (error === 'invalid-address' || error === 'address-unreachable') setError(null)
  }
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
      {BANNER_ERRORS.has(error) && <Banner tone="error">{errorText(error, undefined, askAddress)}</Banner>}
      {askAddress && localhost && (error === 'address-unreachable' || error === 'not-qbittorrent') && (
        <LocalhostHint
          service="qbittorrent"
          hostAddress={localhost.hostAddress}
          onUse={(hostAddress) => {
            setAddress(hostAddress)
            setError(null)
          }}
        />
      )}
      {source && <BypassHint source={source} />}

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
            onChange={(e) => changeAddress(e.target.value)}
            error={(error === 'invalid-address' || error === 'address-unreachable') && errorText(error, failureText(t, 'qbittorrent', failure))}
            help={t('connect.addressHelp')}
          />
        )}
        {askAddress && (
          <FindAddress
            service="qbittorrent"
            onPick={changeAddress}
            onRefused={(code) => (code === 'auth-off' ? setError('auth-off') : onEnvAddress())}
          />
        )}
        <Input
          label={t('connect.username')}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          // qBittorrent's auth bypass may let the server in without a login, and a Connect with none
          // checks again once it's turned on (#519), with no reload the Home Screen app hasn't got. Half a
          // login isn't sent: a password alone would go as none, a username alone as a login to refuse.
          required={password !== ''}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
            clearLoginError()
          }}
          error={error === 'invalid' || error === 'login-needed'}
          help={t('connect.loginOptional')}
        />
        <Input
          label={t('connect.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          required={username.trim() !== ''}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            clearLoginError()
          }}
          error={(error === 'invalid' || error === 'login-needed') && errorText(error)}
        />
      </div>

      <Button type="submit" size="lg" block loading={sending !== undefined}>
        {t('connect.submit')}
      </Button>
      {actions}
    </form>
  )
}
