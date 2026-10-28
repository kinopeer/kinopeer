import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsError, saveProwlarrKey, type ServerSettings } from '../api/settings'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'

export interface ProwlarrKeyFormProps {
  onSaved: (settings: ServerSettings) => void
}

type FormError = 'invalid' | 'unreachable' | 'not-configured' | 'storage' | 'failed' | null

/** The Prowlarr key field: the server checks the key with Prowlarr, then keeps it. */
export function ProwlarrKeyForm({ onSaved }: ProwlarrKeyFormProps) {
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<FormError>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      onSaved(await saveProwlarrKey(apiKey.trim()))
    } catch (e) {
      const code = e instanceof SettingsError ? e.code : undefined
      setError(
        code === 'invalid-key' || code === 'bad-request'
          ? 'invalid'
          : code === 'unreachable' || code === 'not-configured' || code === 'storage'
            ? code
            : 'failed',
      )
      setSaving(false)
    }
  }

  return (
    <form className="key-form" onSubmit={handleSubmit}>
      <p className="t-body c2">{t('prowlarrKey.help')}</p>

      {error === 'unreachable' && <Banner tone="error">{t('prowlarrKey.unreachable')}</Banner>}
      {error === 'not-configured' && <Banner tone="error">{t('prowlarrKey.notConfigured')}</Banner>}
      {error === 'storage' && <Banner tone="error">{t('tmdbKey.storage')}</Banner>}
      {error === 'failed' && <Banner tone="error">{t('tmdbKey.failed')}</Banner>}

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
        <Button type="submit" size="lg" block loading={saving}>
          {t('tmdbKey.save')}
        </Button>
      </div>
    </form>
  )
}
