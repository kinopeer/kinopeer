import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsError, forgetTmdbKey, saveTmdbKey, type ServerSettings, type TmdbFallback } from '../api/settings'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'

/** Where to get a key: TMDB account → Settings → API. */
export const TMDB_API_SETTINGS_URL = 'https://www.themoviedb.org/settings/api'

export interface TmdbKeyFormProps {
  onSaved: (settings: ServerSettings) => void
  /**
   * A key saved from the app is in use and `to` would serve TMDB without it: offer to go back to
   * it, then `onForgotten`.
   */
  forget?: { to: TmdbFallback; onForgotten: (settings: ServerSettings) => void }
  /** Under the Save button, e.g. Skip. */
  secondary?: ReactNode
}

type FormError = 'invalid' | 'unreachable' | 'storage' | 'no-server-key' | 'failed' | 'forget-failed' | null

function formError(e: unknown, kind: 'save' | 'forget'): FormError {
  const code = e instanceof SettingsError ? e.code : undefined
  if (kind === 'save' && (code === 'invalid-key' || code === 'bad-request')) return 'invalid'
  if (code === 'storage' || code === 'unreachable' || code === 'no-server-key') return code
  return kind === 'save' ? 'failed' : 'forget-failed'
}

/** The TMDB key field: the server checks the key with TMDB, then keeps it. */
export function TmdbKeyForm({ onSaved, forget, secondary }: TmdbKeyFormProps) {
  const { t } = useTranslation()
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
    void run('save', () => saveTmdbKey(apiKey.trim()), onSaved)
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
      {error === 'storage' && <Banner tone="error">{t('keyForm.storage')}</Banner>}
      {error === 'no-server-key' && <Banner tone="error">{t('tmdbKey.noFallback')}</Banner>}
      {error === 'failed' && <Banner tone="error">{t('keyForm.failed')}</Banner>}
      {error === 'forget-failed' && <Banner tone="error">{t('tmdbKey.forgetFailed')}</Banner>}

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
        <Button type="submit" size="lg" block loading={busy === 'save'} disabled={busy === 'forget'}>
          {t('common.save')}
        </Button>
        {forget && (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            block
            loading={busy === 'forget'}
            disabled={busy === 'save'}
            onClick={() => void run('forget', forgetTmdbKey, forget.onForgotten)}
          >
            {t(forget.to === 'shared' ? 'tmdbKey.forgetToShared' : 'keyForm.useServerKey')}
          </Button>
        )}
        {secondary}
      </div>
    </form>
  )
}
