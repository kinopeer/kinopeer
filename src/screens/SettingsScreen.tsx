import { useCallback, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { ProwlarrSetupError, getProwlarrStatus } from '../api/prowlarr'
import { getApiVersion, getAppVersion, getCategories } from '../api/qbittorrent'
import { TmdbKeyError, checkTmdb } from '../api/tmdb'
import { getServerSettings } from '../api/settings'
import { Button } from '../components/Button'
import { Icon, type IconName } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Segmented } from '../components/Segmented'
import { Sheet } from '../components/Sheet'
import { Toast } from '../components/Toast'
import { Toggle } from '../components/Toggle'
import { LANGUAGES } from '../i18n'
import { promptInstall, useInstallMethod, type ManualInstall } from '../pwa/install'
import { useRequest } from '../lib/useRequest'
import { useSettings, type Settings } from '../settings/settings'
import type { ThemePreference } from '../theme/theme'
import { useTheme } from '../theme/useTheme'
import { categoryType, clearTitleMatches } from '../torrents/titleMatches'
import { InstallSheet } from './InstallSheet'
import { ProwlarrKeyForm } from './ProwlarrKeyForm'
import { TmdbKeyForm } from './TmdbKeyForm'
import './SettingsScreen.css'

/** Location state that opens the TMDB key sheet, e.g. from Search when the key is missing. */
export interface SettingsLocationState {
  editTmdbKey?: boolean
}

interface ConnectionRowProps {
  name: string
  icon: IconName
  /** Resolves to the success message, rejects with the error message. */
  check: () => Promise<string>
  /** Accessible name of the edit button, shown only with `onEdit`. */
  editLabel?: string
  onEdit?: () => void
}

/** One service's connection: checked when the screen opens and again, on its own, on Test. */
function ConnectionRow({ name, icon, check, editLabel, onEdit }: ConnectionRowProps) {
  const { t, i18n } = useTranslation()
  const result = useRequest(`${name}|${i18n.language}`, check)
  const state = result.loading ? 'loading' : result.error !== undefined ? 'error' : 'ok'
  const message = result.loading
    ? t('settings.testing')
    : result.error !== undefined
      ? result.error instanceof Error
        ? result.error.message
        : String(result.error)
      : result.data

  return (
    <li className={state === 'ok' ? 'ks-conn is-ok' : state === 'error' ? 'ks-conn is-err' : 'ks-conn is-loading'}>
      <span className="ks-conn-ic" aria-hidden="true">
        {state === 'loading' ? <span className="ks-spin" /> : <Icon name={state === 'ok' ? 'check-circle' : icon} />}
      </span>
      <span className="settings-conn-text">
        <span className="settings-conn-name">{name}</span>
        <span className={state === 'error' ? 't-cap c-err' : 't-cap c2'} role="status">
          {message}
        </span>
      </span>
      {onEdit && editLabel && <IconButton icon="key" label={editLabel} onClick={onEdit} />}
      <Button variant="secondary" size="sm" disabled={state === 'loading'} onClick={result.retry}>
        {t('settings.test')}
      </Button>
    </li>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={`settings-section ${id}`} aria-labelledby={id}>
      <h2 id={id} className="ks-label settings-section-title">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function SettingsScreen() {
  const { t, i18n } = useTranslation()
  const { preference, setPreference } = useTheme()
  const [settings, update] = useSettings()
  const [tmdbKeyVersion, setTmdbKeyVersion] = useState(0)
  const [cleared, setCleared] = useState(false)
  const installMethod = useInstallMethod()
  const [installSteps, setInstallSteps] = useState<ManualInstall | null>(null)
  const location = useLocation()
  const [editingKey, setEditingKey] = useState(
    () => (location.state as SettingsLocationState | null)?.editTmdbKey === true,
  )
  const [editingProwlarrKey, setEditingProwlarrKey] = useState(false)
  const [prowlarrKeyVersion, setProwlarrKeyVersion] = useState(0)
  const [keySaved, setKeySaved] = useState<'tmdb' | 'prowlarr' | null>(null)
  const dismissKeySaved = useCallback(() => setKeySaved(null), [])
  const dismissCleared = useCallback(() => setCleared(false), [])
  const categories = useRequest('qbt|categories', () => getCategories())
  const server = useRequest(`server|settings|${attempt}`, () => getServerSettings())
  const names = (categories.data ?? []).map((category) => category.name).sort((a, b) => a.localeCompare(b))

  const checkQbittorrent = async () => {
    try {
      const [app, api] = await Promise.all([getAppVersion(), getApiVersion()])
      return t('settings.qbtOk', { version: app, api })
    } catch {
      throw new Error(t('settings.qbtError'))
    }
  }

  const checkProwlarr = async () => {
    try {
      const status = await getProwlarrStatus()
      return t('settings.prowlarrOk', { count: status.indexers, version: status.version })
    } catch (error) {
      throw new Error(error instanceof ProwlarrSetupError ? t('settings.prowlarrSetup') : t('settings.prowlarrError'))
    }
  }

  const checkTmdbKey = async () => {
    try {
      await checkTmdb()
      return t('settings.tmdbOk')
    } catch (error) {
      throw new Error(error instanceof TmdbKeyError ? t('settings.tmdbKey') : t('settings.tmdbError'))
    }
  }

  const categoryField = (type: 'movie' | 'tv') => {
    const key: keyof Settings = type === 'movie' ? 'movieCategory' : 'tvCategory'
    const automatic = names.find((name) => categoryType(name) === type)
    const id = `settings-category-${type}`
    const value = settings[key] && names.includes(settings[key]) ? settings[key] : ''
    return (
      <div className="ks-field">
        <label htmlFor={id} className="ks-label settings-field-label">
          <Icon name={type === 'movie' ? 'film' : 'tv'} size={18} />
          {type === 'movie' ? t('settings.moviesCategory') : t('settings.seriesCategory')}
        </label>
        <span className="settings-select">
          <select
            id={id}
            value={value}
            disabled={!categories.data}
            onChange={(event) => update({ [key]: event.target.value || undefined })}
          >
            <option value="">
              {automatic ? t('settings.categoryAuto', { name: automatic }) : t('settings.categoryNone')}
            </option>
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={18} />
        </span>
      </div>
    )
  }

  const themeOptions: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: t('theme.system') },
    { value: 'dark', label: t('theme.dark') },
    { value: 'light', label: t('theme.light') },
  ]
  const languageOptions = LANGUAGES.map((language) => ({ value: language.code as string, label: language.name }))
  const tmdbOptions: { value: Settings['tmdbLanguage']; label: string }[] = [
    { value: 'app', label: t('settings.tmdbAsApp') },
    { value: 'en-US', label: 'English' },
    { value: 'ru-RU', label: 'Русский' },
  ]

  return (
    <main className="settings">
      <h1 className="t-h1 settings-title">{t('settings.title')}</h1>

      <Section id="settings-connections" title={t('settings.connections')}>
        <ul className="settings-conns">
          <ConnectionRow name="qBittorrent" icon="server" check={checkQbittorrent} />
          {/* A new key remounts the row, so it checks again. */}
          <ConnectionRow
            key={`prowlarr-${prowlarrKeyVersion}`}
            name="Prowlarr"
            icon="search"
            check={checkProwlarr}
            editLabel={t('prowlarrKey.change')}
            onEdit={() => setEditingProwlarrKey(true)}
          />
          <ConnectionRow
            key={tmdbKeyVersion}
            name="TMDB"
            icon="film"
            check={checkTmdbKey}
            editLabel={t('tmdbKey.change')}
            onEdit={() => setEditingKey(true)}
          />
        </ul>
        <p className="t-cap c3 settings-hint">{t('settings.connectionsHint')}</p>
      </Section>

      <Section id="settings-defaults" title={t('settings.downloadDefaults')}>
        <div className="ks-card settings-card">
          {categoryField('movie')}
          {categoryField('tv')}
          <div className="settings-toggle">
            <span className="t-body">{t('add.startPaused')}</span>
            <Toggle
              label={t('add.startPaused')}
              checked={settings.startPaused}
              onChange={(startPaused) => update({ startPaused })}
            />
          </div>
          <div className="settings-toggle">
            <span className="t-body">{t('add.sequential')}</span>
            <Toggle
              label={t('add.sequential')}
              checked={settings.sequential}
              onChange={(sequential) => update({ sequential })}
            />
          </div>
        </div>
        <p className="t-cap c3 settings-hint">{t('settings.defaultsHint')}</p>
      </Section>

      <Section id="settings-appearance" title={t('settings.appearance')}>
        <div className="ks-card settings-card">
          <div className="ks-field">
            <span className="ks-label">{t('theme.label')}</span>
            <Segmented options={themeOptions} value={preference} onChange={setPreference} label={t('theme.label')} />
          </div>
          <div className="ks-field">
            <span className="ks-label">{t('language.label')}</span>
            <Segmented
              options={languageOptions}
              value={i18n.resolvedLanguage ?? 'en'}
              onChange={(code) => void i18n.changeLanguage(code)}
              label={t('language.label')}
            />
          </div>
          <div className="ks-field">
            <span className="ks-label">{t('settings.tmdbLanguage')}</span>
            <Segmented
              options={tmdbOptions}
              value={settings.tmdbLanguage}
              onChange={(tmdbLanguage) => update({ tmdbLanguage })}
              label={t('settings.tmdbLanguage')}
            />
          </div>
        </div>
      </Section>

      <Section id="settings-about" title={t('settings.about')}>
        <ul className="ks-card settings-rows">
          <li className="settings-row-static">
            <span className="settings-row-text">{t('settings.version')}</span>
            <span className="c3 ks-num">{__APP_VERSION__}</span>
          </li>
          {installMethod && (
            <li>
              <button
                type="button"
                className="ks-row-btn"
                onClick={() =>
                  installMethod === 'prompt' ? void promptInstall() : setInstallSteps(installMethod)
                }
              >
                <Icon name="download" className="c2" />
                <span className="settings-row-text">
                  <span>{t('settings.installApp')}</span>
                  <span className="t-cap c3">{t('settings.installAppHint')}</span>
                </span>
              </button>
            </li>
          )}
          <li>
            <button
              type="button"
              className="ks-row-btn"
              onClick={() => {
                void clearTitleMatches().then(() => setCleared(true))
              }}
            >
              <Icon name="refresh" className="c2" />
              <span className="settings-row-text">
                <span>{t('settings.clearCache')}</span>
                <span className="t-cap c3">{t('settings.clearCacheHint')}</span>
              </span>
            </button>
          </li>
        </ul>
      </Section>

      <InstallSheet platform={installSteps} onClose={() => setInstallSteps(null)} />
      <Sheet open={editingKey} onClose={() => setEditingKey(false)} title={t('tmdbKey.sheetTitle')}>
        <TmdbKeyForm
          onSaved={() => {
            setEditingKey(false)
            setKeySaved('tmdb')
            setTmdbKeyVersion((n) => n + 1)
          }}
        />
      </Sheet>
      <Sheet open={editingProwlarrKey} onClose={() => setEditingProwlarrKey(false)} title={t('prowlarrKey.sheetTitle')}>
        <ProwlarrKeyForm
          saved={server.data?.prowlarr?.source === 'saved'}
          onSaved={() => {
            setEditingProwlarrKey(false)
            setKeySaved('prowlarr')
            setProwlarrKeyVersion((n) => n + 1)
          }}
        />
      </Sheet>
      {cleared && <Toast message={t('settings.cacheCleared')} onDismiss={dismissCleared} />}
      {keySaved && (
        <Toast message={t(keySaved === 'tmdb' ? 'tmdbKey.saved' : 'prowlarrKey.saved')} onDismiss={dismissKeySaved} />
      )}
    </main>
  )
}
