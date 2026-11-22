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
  | 'store-full'
  | 'mixed-content'
  | 'failed'
  | 'forget-failed'
  | null

const KNOWN_ERRORS = new Set<string>(['invalid-address', 'unreachable', 'not-prowlarr', 'not-configured', 'no-server-key', 'env-address', 'auth-off', 'storage'])

function formError(e: unknown, kind: 'save' | 'forget'): FormError {
  const code = e instanceof SettingsError ? e.code : undefined
  if (kind === 'save' && (code === 'invalid-key' || code === 'bad-request')) return 'invalid'
  if (code && KNOWN_ERRORS.has(code)) return code as FormError
  // Only the WebUI build's qBittorrent keeps the key in a store that can be full, and only its page calls Prowlarr.
  if (__WEBUI__ && (code === 'store-full' || code === 'mixed-content')) return code
  return kind === 'save' ? 'failed' : 'forget-failed'
}

/** The key's save or forgetting (`useSaves`): one target, since both change what the server keeps. */
const PROWLARR_SAVES = 'prowlarr'
const KEY = 'key'
interface Sent {
  kind: 'save' | 'forget'
  url?: string
}

/** The Prowlarr key field: the server checks the key with Prowlarr, then keeps it; in the WebUI build qBittorrent keeps it. */
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

  // Whether the check refused was of an address: its field says why, else the banner does.
  const [checkedAddress, setCheckedAddress] = useState<boolean>()

  function fail(e: unknown, { kind, url }: Sent) {
    const error = formError(e, kind)
    setCheckedAddress(url !== undefined)
    setFailure(failureOf(e))
    setLocalhost(e instanceof SettingsError ? e.container : undefined)
    setError(error)
    if (error === 'env-address') onEnvAddress?.()
  }

  // Open, the form takes every save, for its caller to follow, and every failure it can show: one that
  // asks for no address can't show what refused one.
  const saving = useSaves<Sent>(PROWLARR_SAVES, (outcome, sent) => {
    if (outcome.ok) (sent.kind === 'save' ? onSaved : onForgotten)?.(outcome.result as ServerSettings)
    else if (sent.url !== undefined && !askAddress) return false
    else fail(outcome.error, sent)
    return true
  })
  // One request at a time, from this form or one opened before it, which this one starts from:
  // saving and forgetting at once would race for what the server keeps.
  const sending = saving.pending(KEY)
  const busy = sending?.kind ?? null
  const [address, setAddress] = useState(sending?.url ?? initialAddress)
  const [apiKey, setApiKey] = useState('')

  const run = async (kind: Sent['kind'], request: () => Promise<ServerSettings>, done?: (settings: ServerSettings) => void) => {
    // Nothing goes while a request is on its way, and what it shows stays.
    if (busy) return
    setError(null)
    // Forgetting sends no address.
    const sent = { kind, url: askAddress && kind === 'save' ? address : undefined }
    const settled = await saving.send(KEY, sent, request)
    // No form took it: the caller still follows a save, and a toast says what failed.
    if (!settled || settled.taken) return
    if (settled.ok) return done?.(settled.result)
    const failed = formError(settled.error, kind)
    if (failed === 'env-address') onEnvAddress?.()
    toast.show(errorText(failed, failureText(t, 'prowlarr', failureOf(settled.error)), sent.url !== undefined, true), { icon: 'alert' })
  }

  /**
   * What a failure says, on its field or in a banner, or in a toast once the form is gone (`named`,
   * which names what failed): one wording per failure for both. `checked`: the check was of an address.
   */
  function errorText(failed: FormError, why?: string, checked?: boolean, named?: boolean): string {
    if (failed === 'invalid') return t('prowlarrKey.invalid')
    if (failed === 'invalid-address') return t('address.invalid')
    if (failed === 'unreachable') return why ?? t(checked ? 'prowlarrKey.addressUnreachable' : 'prowlarrKey.unreachable')
    // An address from the app, typed here or saved before, is checked here; the environment's on the server.
    if (failed === 'not-prowlarr') return t('prowlarrKey.notProwlarr', { context: checked || addressFromApp ? 'app' : undefined })
    if (failed === 'not-configured') return t('prowlarrKey.notConfigured')
    if (failed === 'no-server-key') return t('prowlarrKey.noServerKey')
    // Both refuse an address the app sends, which trying again won't change.
    if (failed === 'env-address') return t('prowlarrKey.envAddress')
    if (failed === 'auth-off') return t('prowlarrKey.authOff')
    if (failed === 'storage') return t('keyForm.storage')
    if (__WEBUI__ && failed === 'store-full') return t('webui.prowlarrStoreFull')
    if (__WEBUI__ && failed === 'mixed-content') return t('webui.prowlarrMixedContent')
    if (failed === 'forget-failed') return t('prowlarrKey.forgetFailed')
    // Else that it failed, which trying again may change.
    return named ? t('prowlarrKey.saveFailed', { context: checked ? 'address' : undefined }) : t('keyForm.failed')
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run('save', () => (askAddress ? saveProwlarrKey(apiKey.trim(), address) : saveProwlarrKey(apiKey.trim())), onSaved)
  }
  // With an address sent, the server is there and says that address didn't answer: the field's to fix.
  const why = failureText(t, 'prowlarr', failure)
  // Only on a field there is: a form that stopped asking for the address says it in the banner.
  const addressError =
    askAddress &&
    (error === 'invalid-address' || (__WEBUI__ && error === 'mixed-content') || (checkedAddress && error === 'unreachable')) &&
    errorText(error, why, true)

  const changeAddress = (value: string) => {
    setAddress(value)
    // The hint was for the address checked.
    setLocalhost(undefined)
    if (addressError) setError(null)
  }

  return (
    <form className="key-form" onSubmit={handleSubmit}>
      <p className="t-body c2">{t('prowlarrKey.help')}</p>
      {/* The page calls Prowlarr with the key, a stated exception to keeping secrets on a server (docs/SPEC.md, 2026-11-22). */}
      {__WEBUI__ ? (
        <Banner tone="info" live={false} title={t('webui.prowlarrKeySeenTitle')}>
          {t('webui.prowlarrKeySeen')}
        </Banner>
      ) : null}

      {error && error !== 'invalid' && !addressError && (
        <Banner tone="error" title={error === 'unreachable' && why ? t('noAnswer.prowlarr') : undefined}>
          {errorText(error, why, checkedAddress)}
        </Banner>
      )}
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
          help={t(__WEBUI__ ? 'webui.prowlarrAddressHelp' : 'prowlarrKey.addressHelp')}
        />
      )}
      {/* Find asks Kinopeer's server to look, which the WebUI build has none of. */}
      {!__WEBUI__ && askAddress && (
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
        error={error === 'invalid' && errorText(error)}
        // The WebUI build checks it with Prowlarr, then keeps it in qBittorrent, where the browser reads it to call Prowlarr.
        help={t(__WEBUI__ ? 'webui.prowlarrKeyFieldHelp' : 'prowlarrKey.fieldHelp')}
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
            onClick={() => void run('forget', forgetProwlarrKey, onForgotten)}
          >
            {t('keyForm.useServerKey')}
          </Button>
        )}
        {secondary}
      </div>
    </form>
  )
}
