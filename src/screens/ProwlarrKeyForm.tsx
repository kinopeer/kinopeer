import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsError, forgetProwlarrKey, saveProwlarrKey, type ServerSettings } from '../api/settings'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'

export interface ProwlarrKeyFormProps {
  onSaved: (settings: ServerSettings) => void
  /** The saved key was forgotten: the server's own applies again. Needed with `canForget`. */
  onForgotten?: (settings: ServerSettings) => void
  /** A key saved from the app is in use and the server has one of its own: offer to go back to it. */
  canForget?: boolean
  /** The server has no address for Prowlarr: ask for one beside the key, which the server saves with it. */
  askAddress?: boolean
  /** Prowlarr's address was saved from the app, not set on the server, which is what a wrong one is said to be. */
  addressFromApp?: boolean
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
  | 'storage'
  | 'failed'
  | 'forget-failed'
  | null

const KNOWN_ERRORS = new Set<string>(['invalid-address', 'unreachable', 'not-prowlarr', 'not-configured', 'no-server-key', 'storage'])

function formError(e: unknown, kind: 'save' | 'forget'): FormError {
  const code = e instanceof SettingsError ? e.code : undefined
  if (kind === 'save' && (code === 'invalid-key' || code === 'bad-request')) return 'invalid'
  if (code && KNOWN_ERRORS.has(code)) return code as FormError
  return kind === 'save' ? 'failed' : 'forget-failed'
}

/** The Prowlarr key field: the server checks the key with Prowlarr, then keeps it. */
export function ProwlarrKeyForm({ onSaved, onForgotten, canForget = false, askAddress = false, addressFromApp = false, secondary }: ProwlarrKeyFormProps) {
  const { t } = useTranslation()
  const [address, setAddress] = useState('')
  const [apiKey, setApiKey] = useState('')
  // One request at a time: saving and forgetting at once would race for what the server keeps.
  const [busy, setBusy] = useState<'save' | 'forget' | null>(null)
  const [error, setError] = useState<FormError>(null)

  const run = async (kind: 'save' | 'forget', request: () => Promise<ServerSettings>, done: (settings: ServerSettings) => void) => {
    if (busy) return
    setBusy(kind)
    setError(null)
    try {
      done(await request())
    } catch (e) {
      setError(formError(e, kind))
      setBusy(null)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run('save', () => (askAddress ? saveProwlarrKey(apiKey.trim(), address.trim()) : saveProwlarrKey(apiKey.trim())), onSaved)
  }
  // With an address sent, the server is there and says that address didn't answer: the field's to fix.
  const addressError = (error === 'invalid-address' && t('address.invalid')) || (askAddress && error === 'unreachable' && t('prowlarrKey.addressUnreachable'))

  return (
    <form className="key-form" onSubmit={handleSubmit}>
      <p className="t-body c2">{t('prowlarrKey.help')}</p>

      {error === 'unreachable' && !askAddress && <Banner tone="error">{t('prowlarrKey.unreachable')}</Banner>}
      {error === 'not-prowlarr' && (
        <Banner tone="error">{t('prowlarrKey.notProwlarr', { context: askAddress || addressFromApp ? 'app' : undefined })}</Banner>
      )}
      {error === 'not-configured' && <Banner tone="error">{t('prowlarrKey.notConfigured')}</Banner>}
      {error === 'no-server-key' && <Banner tone="error">{t('prowlarrKey.noServerKey')}</Banner>}
      {error === 'storage' && <Banner tone="error">{t('keyForm.storage')}</Banner>}
      {error === 'failed' && <Banner tone="error">{t('keyForm.failed')}</Banner>}
      {error === 'forget-failed' && <Banner tone="error">{t('prowlarrKey.forgetFailed')}</Banner>}

      {askAddress && (
        <Input
          label={t('prowlarrKey.address')}
          name="prowlarr-url"
          type="url"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          mono
          required
          value={address}
          onChange={(event) => {
            setAddress(event.target.value)
            if (addressError) setError(null)
          }}
          error={addressError}
          help={t('prowlarrKey.addressHelp')}
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
