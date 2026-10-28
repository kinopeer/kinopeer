import { useCallback, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { ProwlarrSetupError, getProwlarrStatus } from '../api/prowlarr'
import { getApiVersion, getAppVersion, getCategories } from '../api/qbittorrent'
import { TmdbKeyError, checkTmdb } from '../api/tmdb'
import { getServerSettings, type ServerSettings } from '../api/settings'
import { Button } from '../components/Button'
import { Icon, type IconName } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Segmented } from '../components/Segmented'
import { Sheet } from '../components/Sheet'
import { Toast } from '../components/Toast'
import { Toggle } from '../components/Toggle'
import { LANGUAGES, type LanguagePreference } from '../i18n'
import { useLanguage } from '../i18n/useLanguage'
import { BUG_REPORT_URL, IDEAS_URL, REPO_URL } from '../lib/links'
import { promptInstall, useInstallMethod, type ManualInstall } from '../pwa/install'
import { useRequest } from '../lib/useRequest'
import { useSettings, type Settings } from '../settings/settings'
import type { ThemePreference } from '../theme/theme'
import { useTheme } from '../theme/useTheme'
import { categoryType, clearTitleMatches } from '../torrents/titleMatches'
import tmdbLogo from '../assets/tmdb-logo.svg'
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

type AboutRowProps = {
  icon: IconName
  label: string
  hint: string
} & (
  /** A page on GitHub, opened in a new tab… */
  | { href: string; onClick?: never }
  /** …or an action. */
  | { onClick: () => void; href?: never }
)

/** A row in About: an action, or a page on GitHub opened in a new tab. */
function AboutRow({ icon, label, hint, href, onClick }: AboutRowProps) {
  const { t } = useTranslation()
  const content = (
    <>
      <Icon name={icon} className="c2" />
      <span className="settings-row-text">
        <span>{label}</span>
        <span className="t-cap c3">{hint}</span>
      </span>
    </>
  )
  return (
    <li>
      {href !== undefined ? (
        <a className="ks-row-btn" href={href} target="_blank" rel="noreferrer">
          {content}
          <Icon name="external-link" className="c3" />
          <span className="sr-only">{t('settings.opensInNewTab')}</span>
        </a>
      ) : (
        <button type="button" className="ks-row-btn" onClick={onClick}>
          {content}
        </button>
      )}
    </li>
  )
}

/** The download defaults that are on/off switches, in order; each is labelled by `add.<key>`. */
const DEFAULT_SWITCHES = ['startPaused', 'sequential', 'firstLastPieces'] as const satisfies readonly (keyof Settings)[]

export function SettingsScreen() {
  const { t } = useTranslation()
  const { preference, setPreference } = useTheme()
  const language = useLanguage()
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
  const [keySaved, setKeySaved] = useState<'tmdb' | 'prowlarr' | 'prowlarr-forgotten' | null>(null)
  const dismissKeySaved = useCallback(() => setKeySaved(null), [])
  const dismissCleared = useCallback(() => setCleared(false), [])
  const categories = useRequest('qbt|categories', () => getCategories())
  // Loaded once; a saved or forgotten key answers with the new settings, which replace it.
  const serverLoad = useRequest('server|settings', (signal) => getServerSettings(signal))
  const [serverChanged, setServerChanged] = useState<ServerSettings | null>(null)
  const server = serverChanged ?? serverLoad.data
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
  const languageOptions: { value: LanguagePreference; label: string }[] = [
    { value: 'system', label: t('language.system') },
    ...LANGUAGES.map((language) => ({ value: language.code, label: language.name })),
  ]
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
          {DEFAULT_SWITCHES.map((key) => (
            <div key={key} className="settings-toggle">
              <span className="t-body">{t(`add.${key}`)}</span>
              <Toggle label={t(`add.${key}`)} checked={settings[key]} onChange={(on) => update({ [key]: on })} />
            </div>
          ))}
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
              value={language.preference}
              onChange={language.setPreference}
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
            <AboutRow
              icon="download"
              label={t('settings.installApp')}
              hint={t('settings.installAppHint')}
              onClick={() => (installMethod === 'prompt' ? void promptInstall() : setInstallSteps(installMethod))}
            />
          )}
          <AboutRow
            icon="refresh"
            label={t('settings.clearCache')}
            hint={t('settings.clearCacheHint')}
            onClick={() => {
              void clearTitleMatches().then(() => setCleared(true))
            }}
          />
        </ul>
        <ul className="ks-card settings-rows">
          <AboutRow href={IDEAS_URL} icon="star" label={t('settings.ideas')} hint={t('settings.ideasHint')} />
          <AboutRow href={BUG_REPORT_URL} icon="alert" label={t('settings.reportBug')} hint={t('settings.reportBugHint')} />
          <AboutRow href={REPO_URL} icon="globe" label={t('settings.sourceCode')} hint={t('settings.sourceCodeHint')} />
        </ul>
        <div className="settings-tmdb">
          <img className="settings-tmdb-logo" src={tmdbLogo} alt="TMDB" width={42} height={18} />
          <p className="t-cap c3">
            {t('settings.tmdbSource')}{' '}
            {/* TMDB's required wording, in English in every language. */}
            <span lang="en">{t('settings.tmdbNotice')}</span>
          </p>
        </div>
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
          canForget={server?.prowlarr.source === 'saved' && server.prowlarr.serverKey}
          onSaved={(changed) => {
            setServerChanged(changed)
            setEditingProwlarrKey(false)
            setKeySaved('prowlarr')
            setProwlarrKeyVersion((n) => n + 1)
          }}
          onForgotten={(changed) => {
            setServerChanged(changed)
            setEditingProwlarrKey(false)
            setKeySaved('prowlarr-forgotten')
            setProwlarrKeyVersion((n) => n + 1)
          }}
        />
      </Sheet>
      {cleared && <Toast message={t('settings.cacheCleared')} onDismiss={dismissCleared} />}
      {keySaved && (
        <Toast
          message={t(
            keySaved === 'tmdb' ? 'tmdbKey.saved' : keySaved === 'prowlarr' ? 'prowlarrKey.saved' : 'prowlarrKey.forgotten',
          )}
          onDismiss={dismissKeySaved}
        />
      )}
    </main>
  )
}
