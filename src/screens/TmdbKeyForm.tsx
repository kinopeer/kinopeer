import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsError, saveTmdbKey, type ServerSettings } from '../api/settings'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'

/** Where to get a key: TMDB account → Settings → API. */
export const TMDB_API_SETTINGS_URL = 'https://www.themoviedb.org/settings/api'

export interface TmdbKeyFormProps {
  onSaved: (settings: ServerSettings) => void
  /** Under the Save button, e.g. Skip. */
  secondary?: ReactNode
}

type FormError = 'invalid' | 'unreachable' | 'storage' | 'failed' | null

/** The TMDB key field: the server checks the key with TMDB, then keeps it. */
export function TmdbKeyForm({ onSaved, secondary }: TmdbKeyFormProps) {
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<FormError>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      onSaved(await saveTmdbKey(apiKey.trim()))
    } catch (e) {
      const code = e instanceof SettingsError ? e.code : undefined
      setError(
        code === 'invalid-key' || code === 'bad-request'
          ? 'invalid'
          : code === 'unreachable'
            ? 'unreachable'
            : code === 'storage'
              ? 'storage'
              : 'failed',
      )
      setSaving(false)
    }
  }

  return (
    <form className="key-form" onSubmit={handleSubmit}>
      <p className="t-body c2">
        {t('tmdbKey.help')}{' '}
        <a className="tmdb-key-link" href={TMDB_API_SETTINGS_URL} target="_blank" rel="noreferrer">
          {t('tmdbKey.helpLink')}
        </a>
      </p>

      {error === 'unreachable' && <Banner tone="error">{t('tmdbKey.unreachable')}</Banner>}
      {error === 'storage' && <Banner tone="error">{t('tmdbKey.storage')}</Banner>}
      {error === 'failed' && <Banner tone="error">{t('tmdbKey.failed')}</Banner>}

      <Input
        label={t('tmdbKey.label')}
        name="tmdb-api-key"
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
        error={error === 'invalid' && t('tmdbKey.invalid')}
        help={t('tmdbKey.fieldHelp')}
      />

      <div className="key-form-actions">
        <Button type="submit" size="lg" block loading={saving}>
          {t('tmdbKey.save')}
        </Button>
        {secondary}
      </div>
    </form>
  )
}
