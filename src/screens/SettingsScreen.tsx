import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { ProwlarrSetupError, getProwlarrStatus } from '../api/prowlarr'
import { getAppVersion, getCategories, unreachable } from '../api/qbittorrent'
import { TmdbKeyError, checkTmdb } from '../api/tmdb'
import { getServerSettings, type ServerSettings } from '../api/settings'
import { Button } from '../components/Button'
import { Icon, type IconName } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Segmented } from '../components/Segmented'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { Toggle } from '../components/Toggle'
import { LANGUAGES, type LanguagePreference } from '../i18n'
import { useLanguage } from '../i18n/useLanguage'
import { BUG_REPORT_URL, IDEAS_URL, REPO_URL } from '../lib/links'
import { promptInstall, useInstallMethod, type ManualInstall } from '../pwa/install'
import { useRequest, type RequestState } from '../lib/useRequest'
import { useScrollRestoration } from '../lib/useScrollRestoration'
import { useSettings, type Settings } from '../settings/settings'
import type { ThemePreference } from '../theme/theme'
import { useTheme } from '../theme/useTheme'
import { categoryType, clearTitleMatches } from '../torrents/titleMatches'
import tmdbLogo from '../assets/tmdb-logo.svg'
import { unreachableText } from '../lib/unreachable'
import { InstallSheet } from './InstallSheet'
import { ProwlarrKeyForm } from './ProwlarrKeyForm'
import { TmdbKeyForm } from './TmdbKeyForm'
import './SettingsScreen.css'

/** Location state that opens the TMDB key sheet, e.g. from Search when the key is missing. */
export interface SettingsLocationState {
  editTmdbKey?: boolean
}

/** What a connection's card says: still checking, connected (perhaps with a warning), or why not. */
type ConnectionStatus = { state: 'loading' } | { state: 'ok' | 'warn' | 'error'; message: string }

/** The status of a check: `ok` describes what it answered, `failed` why it failed. */
function connectionStatus<T>(
  check: RequestState<T>,
  ok: (data: T) => { message: string; warn?: boolean },
  failed: (error: unknown) => string,
): ConnectionStatus {
  if (check.loading) return { state: 'loading' }
  if (check.error !== undefined) return { state: 'error', message: failed(check.error) }
  const { message, warn } = ok(check.data as T)
  return { state: warn ? 'warn' : 'ok', message }
}

const CONNECTION_CLASS = { loading: 'is-loading', ok: 'is-ok', warn: 'is-warn', error: 'is-err' } as const
const MESSAGE_CLASS = { loading: 'c2', ok: 'c2', warn: 'c-warn', error: 'c-err' } as const

interface ConnectionRowProps {
  name: string
  icon: IconName
  status: ConnectionStatus
  /** Runs the check again. */
  onTest: () => void
  /** Accessible name of the edit button, shown only with `onEdit`. */
  editLabel?: string
  onEdit?: () => void
}

/** One service's connection: its status, and Test to check it again. */
function ConnectionRow({ name, icon, status, onTest, editLabel, onEdit }: ConnectionRowProps) {
  const { t } = useTranslation()
  const { state } = status
  return (
    <li className={`ks-conn ${CONNECTION_CLASS[state]}`}>
      <span className="ks-conn-ic" aria-hidden="true">
        {state === 'loading' ? (
          <span className="ks-spin" />
        ) : (
          <Icon name={state === 'ok' ? 'check-circle' : state === 'warn' ? 'alert' : icon} />
        )}
      </span>
      <span className="settings-conn-text">
        <span className="settings-conn-name">{name}</span>
        <span className={`t-cap ${MESSAGE_CLASS[state]}`} role="status">
          {status.state === 'loading' ? t('settings.testing') : status.message}
        </span>
      </span>
      {onEdit && editLabel && <IconButton icon="key" label={editLabel} onClick={onEdit} />}
      <Button variant="secondary" size="sm" disabled={state === 'loading'} onClick={onTest}>
        {t('settings.test')}
      </Button>
    </li>
  )
}

/** A row in About that shows a value; "—" while it isn't known (Connections says why). */
function AboutValue({ label, value }: { label: string; value: string | number | undefined }) {
  const { t } = useTranslation()
  return (
    <li className="settings-row-static">
      <span className="settings-row-text">{label}</span>
      {value === undefined ? (
        <span className="settings-row-unknown">
          <span aria-hidden="true">—</span>
          <span className="sr-only">{t('settings.versionUnknown')}</span>
        </span>
      ) : (
        <span className="c3 ks-num">{value}</span>
      )}
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
  const installMethod = useInstallMethod()
  const [installSteps, setInstallSteps] = useState<ManualInstall | null>(null)
  const location = useLocation()
  const [editingKey, setEditingKey] = useState(
    () => (location.state as SettingsLocationState | null)?.editTmdbKey === true,
  )
  const [editingProwlarrKey, setEditingProwlarrKey] = useState(false)
  const [prowlarrKeyVersion, setProwlarrKeyVersion] = useState(0)
  const toast = useToast()
  // Its checks and loads change no heights, so the page is ready to scroll back at once.
  useScrollRestoration(true, '/settings')
  // Asked after each passing qBittorrent check (on opening, on Test) while
  // they're missing, so a check that finds it back loads them, and loaded selects don't empty on Test.
  const [categoriesLoad, setCategoriesLoad] = useState(0)
  const categories = useRequest(categoriesLoad === 0 ? null : `qbt|categories|${categoriesLoad}`, (signal) => getCategories(signal))
  // Loaded once; a saved or forgotten key answers with the new settings, which replace it.
  const serverLoad = useRequest('server|settings', (signal) => getServerSettings(signal))
  const [serverChanged, setServerChanged] = useState<ServerSettings | null>(null)
  const server = serverChanged ?? serverLoad.data
  const names = (categories.data ?? []).map((category) => category.name).sort((a, b) => a.localeCompare(b))
  const sharedTmdbKey = server?.tmdb.source === 'shared'

  // The checks behind Connections, run here so About shows the versions they answer with and
  // starts none of its own; a check running again or failing has no data, so About shows "—".
  // A new key changes its check's key, so it runs again.
  const qbittorrent = useRequest('check|qbittorrent', async (signal) => {
    const version = await getAppVersion(signal)
    if (categories.data === undefined) setCategoriesLoad((n) => n + 1)
    return version
  })
  const prowlarr = useRequest(`check|prowlarr|${prowlarrKeyVersion}`, (signal) => getProwlarrStatus(signal))
  const tmdb = useRequest(`check|tmdb|${tmdbKeyVersion}`, (signal) => checkTmdb(signal))

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
              {automatic ? t('settings.categoryAuto', { name: automatic }) : t('category.none')}
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
      <h1 className="t-h1 settings-title">{t('nav.settings')}</h1>

      <Section id="settings-connections" title={t('settings.connections')}>
        <ul className="settings-conns">
          <ConnectionRow
            name="qBittorrent"
            icon="server"
            status={connectionStatus(qbittorrent, () => ({ message: t('settings.connected') }), (error) => t('noAnswer.qbittorrent', { context: unreachableText(unreachable(error)) }))}
            onTest={qbittorrent.retry}
          />
          <ConnectionRow
            name="Prowlarr"
            icon="search"
            status={connectionStatus(
              prowlarr,
              // Search finds nothing without indexers, so the card warns rather than only connects.
              ({ indexers }) =>
                indexers === 0 ? { message: t('settings.connectedNoIndexers'), warn: true } : { message: t('settings.connected') },
              (error) => (error instanceof ProwlarrSetupError ? t('settings.prowlarrSetup') : t('noAnswer.prowlarr')),
            )}
            onTest={prowlarr.retry}
            editLabel={t('prowlarrKey.change')}
            onEdit={() => setEditingProwlarrKey(true)}
          />
          <ConnectionRow
            name="TMDB"
            icon="film"
            status={connectionStatus(
              tmdb,
              // Kinopeer's own key, behind its proxy: said, so the user knows a key of their own is optional.
              () => ({ message: sharedTmdbKey ? t('settings.connectedSharedKey') : t('settings.connected') }),
              (error) => (error instanceof TmdbKeyError ? t('settings.tmdbKey') : t('noAnswer.tmdb')),
            )}
            onTest={tmdb.retry}
            editLabel={sharedTmdbKey ? t('tmdbKey.useOwn') : t('tmdbKey.change')}
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
          <AboutValue label={t('settings.version')} value={__APP_VERSION__} />
          <AboutValue label={t('settings.qbtVersion')} value={qbittorrent.data} />
          <AboutValue label={t('settings.prowlarrVersion')} value={prowlarr.data?.version} />
          <AboutValue label={t('settings.indexers')} value={prowlarr.data?.indexers} />
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
              void clearTitleMatches().then(() => toast.show(t('settings.cacheCleared')))
            }}
          />
        </ul>
        <ul className="ks-card settings-rows">
          <AboutRow href={IDEAS_URL} icon="star" label={t('settings.ideas')} hint={t('settings.ideasHint')} />
          <AboutRow href={BUG_REPORT_URL} icon="alert" label={t('settings.reportBug')} hint={t('settings.reportBugHint')} />
          <AboutRow href={REPO_URL} icon="globe" label={t('settings.sourceCode')} hint={t('settings.sourceCodeHint')} />
        </ul>
        <div className="settings-tmdb">
          <img className="settings-tmdb-logo" src={tmdbLogo} alt={t('common.tmdb')} width={42} height={18} />
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
          forget={
            server?.tmdb.source === 'saved' && server.tmdb.fallback
              ? {
                  to: server.tmdb.fallback,
                  onForgotten: (changed) => {
                    setServerChanged(changed)
                    setEditingKey(false)
                    toast.show(t(changed.tmdb.source === 'shared' ? 'tmdbKey.forgottenToShared' : 'tmdbKey.forgottenToServer'))
                    setTmdbKeyVersion((n) => n + 1)
                  },
                }
              : undefined
          }
          onSaved={(changed) => {
            setServerChanged(changed)
            setEditingKey(false)
            toast.show(t('tmdbKey.saved'))
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
            toast.show(t('prowlarrKey.saved'))
            setProwlarrKeyVersion((n) => n + 1)
          }}
          onForgotten={(changed) => {
            setServerChanged(changed)
            setEditingProwlarrKey(false)
            toast.show(t('prowlarrKey.forgotten'))
            setProwlarrKeyVersion((n) => n + 1)
          }}
        />
      </Sheet>
    </main>
  )
}
