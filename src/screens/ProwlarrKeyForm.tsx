import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { failureOf, type ConnectionFailure } from '../api/connectionFailure'
import { SettingsError, forgetProwlarrKey, saveProwlarrKey, type ServerSettings } from '../api/settings'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { useToast } from '../components/Toast'
import { failureText } from '../lib/failureText'
import { useSaves } from '../lib/useSaves'
import { LocalhostHint } from './ContainerHints'
import { FindAddress } from './FindAddress'

export interface ProwlarrKeyFormProps {
  onSaved: (settings: ServerSettings) => void
  /** The saved key was forgotten: the server's own applies again. Needed with `canForget`. */
  onForgotten?: (settings: ServerSettings) => void
  /** A key saved from the app is in use and the server has one of its own: offer to go back to it. */
  canForget?: boolean
  /** Ask for Prowlarr's address beside the key, which the server saves with it: where it has none, or one saved from the app. */
  askAddress?: boolean
  /** What the address field starts with: the address saved from the app. */
  initialAddress?: string
  /** Prowlarr's address was saved from the app, not set on the server, which is what a wrong one is said to be. */
  addressFromApp?: boolean
  /** The environment set Prowlarr's address meanwhile, which the form says: load the settings again, which ask for none. */
  onEnvAddress?: () => void
  /** Another action under Save, as onboarding's Skip. */
  secondary?: ReactNode
}

type FormError =
  | 'invalid'
  | 'invalid-address'
  | 'unreachable'
  | 'not-prowlarr'
  | 'not-configured'
  | 'no-server-key'
  | 'env-address'
  | 'auth-off'
  | 'storage'
  | 'failed'
  | 'forget-failed'
  | null

const KNOWN_ERRORS = new Set<string>(['invalid-address', 'unreachable', 'not-prowlarr', 'not-configured', 'no-server-key', 'env-address', 'auth-off', 'storage'])

function formError(e: unknown, kind: 'save' | 'forget'): FormError {
  const code = e instanceof SettingsError ? e.code : undefined
  if (kind === 'save' && (code === 'invalid-key' || code === 'bad-request')) return 'invalid'
  if (code && KNOWN_ERRORS.has(code)) return code as FormError
  return kind === 'save' ? 'failed' : 'forget-failed'
}

/** The key's save or forgetting (`useSaves`): one target, since both change what the server keeps. */
const PROWLARR_SAVES = 'prowlarr'
const KEY = 'key'
interface Sent {
  kind: 'save' | 'forget'
  url?: string
}

/** The Prowlarr key field: the server checks the key with Prowlarr, then keeps it. */
export function ProwlarrKeyForm({
  onSaved,
  onForgotten,
  canForget = false,
  askAddress = false,
  initialAddress = '',
  addressFromApp = false,
  onEnvAddress,
  secondary,
}: ProwlarrKeyFormProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const [error, setError] = useState<FormError>(null)
  // Why Prowlarr didn't answer the check, where the server could tell (#508).
  const [failure, setFailure] = useState<ConnectionFailure>()
  // The address was localhost inside Kinopeer's container (#509), and the host's, when known.
  const [localhost, setLocalhost] = useState<SettingsError['container']>()

  function fail(e: unknown, kind: Sent['kind']) {
    const error = formError(e, kind)
    setFailure(failureOf(e))
    setLocalhost(e instanceof SettingsError ? e.container : undefined)
    setError(error)
    if (error === 'env-address') onEnvAddress?.()
  }

  // Open, the form takes every outcome: a save is the caller's to follow, a failure the form's to say.
  const saving = useSaves<Sent>(PROWLARR_SAVES, (outcome, sent) => {
    if (!outcome.ok) fail(outcome.error, sent.kind)
    return true
  })
  // One request at a time, from this form or one opened before it, which this one starts from:
  // saving and forgetting at once would race for what the server keeps.
  const sending = saving.pending(KEY)
  const busy = sending?.kind ?? null
  const [address, setAddress] = useState(sending?.url ?? initialAddress)
  const [apiKey, setApiKey] = useState('')

  const run = async (kind: Sent['kind'], request: () => Promise<ServerSettings>, done: (settings: ServerSettings) => void) => {
    setError(null)
    const settled = await saving.send(KEY, { kind, url: askAddress ? address : undefined }, request)
    if (!settled) return
    // The caller follows a save whether or not the form is still there.
    if (settled.ok) return done(settled.result)
    if (settled.taken) return
    // The form gone: a toast says what failed.
    const failed = formError(settled.error, kind)
    if (failed === 'env-address') onEnvAddress?.()
    toast.show(
      t(failed === 'env-address' ? 'prowlarrKey.envAddress' : kind === 'save' ? 'prowlarrKey.saveFailed' : 'prowlarrKey.forgetFailed', {
        context: askAddress ? 'address' : undefined,
      }),
      { icon: 'alert' },
    )
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run('save', () => (askAddress ? saveProwlarrKey(apiKey.trim(), address) : saveProwlarrKey(apiKey.trim())), onSaved)
  }
  // With an address sent, the server is there and says that address didn't answer: the field's to fix.
  const why = failureText(t, 'prowlarr', failure)
  const addressError =
    (error === 'invalid-address' && t('address.invalid')) || (askAddress && error === 'unreachable' && (why ?? t('prowlarrKey.addressUnreachable')))

  const changeAddress = (value: string) => {
    setAddress(value)
    // The hint was for the address checked.
    setLocalhost(undefined)
    if (addressError) setError(null)
  }

  return (
    <form className="key-form" onSubmit={handleSubmit}>
      <p className="t-body c2">{t('prowlarrKey.help')}</p>

      {error === 'unreachable' &&
        !askAddress &&
        (why ? (
          <Banner tone="error" title={t('noAnswer.prowlarr')}>
            {why}
          </Banner>
        ) : (
          <Banner tone="error">{t('prowlarrKey.unreachable')}</Banner>
        ))}
      {error === 'not-prowlarr' && (
        <Banner tone="error">{t('prowlarrKey.notProwlarr', { context: askAddress || addressFromApp ? 'app' : undefined })}</Banner>
      )}
      {error === 'not-configured' && <Banner tone="error">{t('prowlarrKey.notConfigured')}</Banner>}
      {error === 'no-server-key' && <Banner tone="error">{t('prowlarrKey.noServerKey')}</Banner>}
      {/* Both refuse an address the app sends, which trying again won't change. */}
      {error === 'env-address' && <Banner tone="error">{t('prowlarrKey.envAddress')}</Banner>}
      {error === 'auth-off' && <Banner tone="error">{t('prowlarrKey.authOff')}</Banner>}
      {error === 'storage' && <Banner tone="error">{t('keyForm.storage')}</Banner>}
      {error === 'failed' && <Banner tone="error">{t('keyForm.failed')}</Banner>}
      {error === 'forget-failed' && <Banner tone="error">{t('prowlarrKey.forgetFailed')}</Banner>}
      {askAddress && localhost && (error === 'unreachable' || error === 'not-prowlarr') && (
        <LocalhostHint
          service="prowlarr"
          hostAddress={localhost.hostAddress}
          onUse={(hostAddress) => {
            setAddress(hostAddress)
            setError(null)
          }}
        />
      )}

      {askAddress && (
        <Input
          label={t('prowlarrKey.address')}
          name="prowlarr-url"
          // Text, not url, as on the connect screen: the server's invalid-address says what's missing.
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          // type="url" turned iOS Safari's autocorrect off; a text field needs it said (#494).
          autoCorrect="off"
          spellCheck={false}
          mono
          required
          value={address}
          onChange={(event) => changeAddress(event.target.value)}
          error={addressError}
          help={t('prowlarrKey.addressHelp')}
        />
      )}
      {askAddress && (
        <FindAddress
          service="prowlarr"
          onPick={changeAddress}
          onRefused={(code) => {
            setError(code)
            if (code === 'env-address') onEnvAddress?.()
          }}
        />
      )}
      <Input
        label={t('prowlarrKey.label')}
        name="prowlarr-api-key"
        mono
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        value={apiKey}
        onChange={(event) => {
          setApiKey(event.target.value)
          if (error === 'invalid') setError(null)
        }}
        error={error === 'invalid' && t('prowlarrKey.invalid')}
        help={t('prowlarrKey.fieldHelp')}
      />

      <div className="key-form-actions">
        <Button type="submit" size="lg" block loading={busy === 'save'} disabled={busy === 'forget'}>
          {t('common.save')}
        </Button>
        {canForget && (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            block
            loading={busy === 'forget'}
            disabled={busy === 'save'}
            onClick={() => void run('forget', forgetProwlarrKey, (settings) => onForgotten?.(settings))}
          >
            {t('keyForm.useServerKey')}
          </Button>
        )}
        {secondary}
      </div>
    </form>
  )
}
