import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { AuthError, signOut } from '../api/auth'
import { failureOf } from '../api/connectionFailure'
import { ProwlarrSetupError, getProwlarrStatus } from '../api/prowlarr'
import { APP_VERSION_FRESH_MS, APP_VERSION_KEY, getAppVersion, getCategories, unreachable } from '../api/qbittorrent'
import { TmdbKeyError, checkTmdb } from '../api/tmdb'
import {
  SERVER_SETTINGS_FRESH_MS,
  SERVER_SETTINGS_KEY,
  SettingsError,
  checkTelegram,
  getServerSettings,
  type AddressStatus,
  type ServerSettings,
} from '../api/settings'
import { Button } from '../components/Button'
import { Icon, type IconName } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Segmented } from '../components/Segmented'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { Toggle } from '../components/Toggle'
import { LANGUAGES, type LanguagePreference } from '../i18n'
import { notifyLanguage } from '../i18n/language'
import { useLanguage } from '../i18n/useLanguage'
import { BUG_REPORT_URL, IDEAS_URL, REPO_URL } from '../lib/links'
import { promptInstall, useInstallMethod, type ManualInstall } from '../pwa/install'
import { useRequest, type RequestState } from '../lib/useRequest'
import { sharedRequests } from '../logic/sharedRequests'
import { useScrollRestoration } from '../lib/useScrollRestoration'
import { useSettings, type Settings } from '../settings/settings'
import type { ThemePreference } from '../theme/theme'
import { useTheme } from '../theme/useTheme'
import { categoryType } from '../torrents/titleLookup'
import { clearTitleMatches } from '../torrents/useTitleMatches'
import tmdbLogo from '../assets/tmdb-logo.svg'
import { failureText } from '../lib/failureText'
import { unreachableText } from '../lib/unreachable'
import { ChangePasswordForm } from './ChangePasswordForm'
import { FoldersSheet } from './FoldersSheet'
import { InstallSheet } from './InstallSheet'
import { ProwlarrKeyForm } from './ProwlarrKeyForm'
import { QbittorrentLoginForm } from './QbittorrentLoginForm'
import { TelegramForm } from './TelegramForm'
import { usePushDevice } from './usePushDevice'
import { TmdbKeyForm } from './TmdbKeyForm'
import './SettingsScreen.css'

/** Location state that opens the TMDB key sheet, e.g. from Search when the key is missing. */
export interface SettingsLocationState {
  editTmdbKey?: boolean
}

/**
 * What a connection's card says: still checking, connected (perhaps with a warning), why not, or
 * that an optional one isn't set up.
 */
type ConnectionStatus = { state: 'loading'; message?: string } | { state: 'ok' | 'warn' | 'error' | 'off'; message: string }

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

const CONNECTION_CLASS = { loading: 'is-loading', ok: 'is-ok', warn: 'is-warn', error: 'is-err', off: '' } as const
const MESSAGE_CLASS = { loading: 'c2', ok: 'c2', warn: 'c-warn', error: 'c-err', off: 'c3' } as const

interface ConnectionRowProps {
  name: string
  icon: IconName
  status: ConnectionStatus
  /** Runs the check again; no Test without it. */
  onTest?: () => void
  /** Accessible name of the edit button, shown only with `onEdit`. */
  editLabel?: string
  onEdit?: () => void
  /** The edit button's icon; a key by default. */
  editIcon?: IconName
  /** Shown in place of the edit button and Test while the status is `off`, or always without Test: the button that sets it up. */
  setUpLabel?: string
  /** Disables the set-up and edit buttons while what they start is in flight; Test is disabled while the status is loading anyway. */
  busy?: boolean
}

/** One service's connection: its status, and Test to check it again, or Set up while it's `off`. */
function ConnectionRow({ name, icon, status, onTest, editLabel, onEdit, editIcon = 'key', setUpLabel, busy }: ConnectionRowProps) {
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
          {status.message ?? t('settings.testing')}
        </span>
      </span>
      {(state === 'off' || !onTest) && setUpLabel && onEdit ? (
        <Button variant="secondary" size="sm" disabled={busy} onClick={onEdit}>
          {setUpLabel}
        </Button>
      ) : (
        <>
          {onEdit && editLabel && <IconButton icon={editIcon} label={editLabel} disabled={busy} onClick={onEdit} />}
          {onTest && (
            <Button variant="secondary" size="sm" disabled={state === 'loading'} onClick={onTest}>
              {t('settings.test')}
            </Button>
          )}
        </>
      )}
    </li>
  )
}

/** The address saved from the app, which a form starts from. */
function savedUrl(address: AddressStatus | undefined): string | undefined {
  return address?.source === 'saved' ? address.url : undefined
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

/**
 * The download defaults that are on/off switches, in order; each is labelled by `add.<key>`. Notify
 * when finished shows only while a channel is set up, as the switch on a torrent's page.
 */
const DEFAULT_SWITCHES = ['startPaused', 'sequential', 'firstLastPieces'] as const satisfies readonly (keyof Settings)[]
const NOTIFY_SWITCHES = [...DEFAULT_SWITCHES, 'notify'] as const satisfies readonly (keyof Settings)[]

export interface SettingsScreenProps {
  /**
   * Saves qBittorrent's login and address and checks the app's session at them (`useQbitSession`'s
   * `signIn`), so the sidebar's version follows, and an old qBittorrent there is said to be too old.
   */
  signIn: (username: string, password: string, url?: string) => Promise<ServerSettings>
}

export function SettingsScreen({ signIn }: SettingsScreenProps) {
  const { t, i18n } = useTranslation()
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
  const [editingQbittorrent, setEditingQbittorrent] = useState(false)
  const [prowlarrKeyVersion, setProwlarrKeyVersion] = useState(0)
  const [changingPassword, setChangingPassword] = useState(false)
  const [editingTelegram, setEditingTelegram] = useState(false)
  // Bumped on each token saved from the sheet, so the card checks again: a renewed token of the same bot keeps its name.
  const [telegramVersion, setTelegramVersion] = useState(0)
  const [editingFolders, setEditingFolders] = useState(false)
  const toast = useToast()
  // Its checks and loads change no heights, so the page is ready to scroll back at once.
  useScrollRestoration(true, '/settings')
  // Asked after each passing qBittorrent check (on opening, on Test) while
  // they're missing, so a check that finds it back loads them, and loaded selects don't empty on Test.
  const [categoriesLoad, setCategoriesLoad] = useState(0)
  const categories = useRequest(categoriesLoad === 0 ? null : `qbt|categories|${categoriesLoad}`, (signal) => getCategories(signal))
  // The page's answer while it's fresh, else loaded once; a saved or forgotten key answers with the
  // new settings, which replace it.
  const serverLoad = useRequest(SERVER_SETTINGS_KEY, (signal) => getServerSettings(signal), { freshFor: SERVER_SETTINGS_FRESH_MS })
  const [serverChanged, setServerChanged] = useState<ServerSettings | null>(null)
  const server = serverChanged ?? serverLoad.data
  // Whether Kinopeer's own login is on is its server's environment's, fixed while it runs, so the
  // page's answer says it however old: the Sign-in section is there from the first render rather
  // than added under the rows when a stale answer is asked again (a layout shift on desktop).
  const [keptAuth] = useState(() => sharedRequests.peek<ServerSettings>(SERVER_SETTINGS_KEY, Infinity)?.data.auth)
  // Set when the server answers that its login is off, which it was turned since that answer.
  const [loginOff, setLoginOff] = useState(false)
  const auth = loginOff ? undefined : server ? server.auth : keptAuth
  // Nothing in the Sign-in section can work any more: it goes, and the page's answer says so too,
  // so Settings opened again doesn't offer it. Without an answer here yet, the one on its way is the
  // page's next, and says it itself: keeping one now would put a partial answer in its place.
  const loginTurnedOff = () => {
    setChangingPassword(false)
    setLoginOff(true)
    if (server) sharedRequests.set<ServerSettings>(SERVER_SETTINGS_KEY, { ...server, auth: { enabled: false } })
    toast.show(t('settings.signInTurnedOff'))
  }
  const names = (categories.data ?? []).map((category) => category.name).sort((a, b) => a.localeCompare(b))
  const sharedTmdbKey = server?.tmdb.source === 'shared'
  // An address changes here only where the server would take one from the app: behind its own login,
  // and where its environment doesn't set it, which it shows as set on the server, not its value.
  const fromApp = (address: AddressStatus | undefined) => auth?.enabled === true && address !== undefined && address.source !== 'env'
  const qbittorrentFromApp = fromApp(server?.qbittorrent.address)
  const prowlarrFromApp = fromApp(server?.prowlarr.address)

  // The checks behind Connections, run here so About shows the versions they answer with and
  // starts none of its own; a check running again or failing has no data, so About shows "—".
  // A new key changes its check's key, so it runs again.
  // qBittorrent's takes the session check's answer while it's fresh; Test asks again.
  const qbittorrent = useRequest(APP_VERSION_KEY, (signal) => getAppVersion(signal), { freshFor: APP_VERSION_FRESH_MS })
  // Set while rendering rather than in an effect, so the categories' request goes out with this render.
  const qbittorrentAnswered = qbittorrent.data !== undefined
  const [answeredBefore, setAnsweredBefore] = useState(false)
  if (answeredBefore !== qbittorrentAnswered) {
    setAnsweredBefore(qbittorrentAnswered)
    if (qbittorrentAnswered && categories.data === undefined) setCategoriesLoad((n) => n + 1)
  }
  const prowlarr = useRequest(`check|prowlarr|${prowlarrKeyVersion}`, (signal) => getProwlarrStatus(signal))
  const tmdb = useRequest(`check|tmdb|${tmdbKeyVersion}`, (signal) => checkTmdb(signal))
  // Asked only with a bot, and again for each bot saved (its name is in the key).
  const telegram = server?.telegram
  const telegramCheck = useRequest(telegram?.bot ? `check|telegram|${telegram.bot}|${telegramVersion}` : null, (signal) => checkTelegram(signal))
  // The card's check as the last render has it, read when a save from the sheet settles, since it may have
  // failed while the save was on its way.
  const telegramCheckNow = useRef(telegramCheck)
  useLayoutEffect(() => {
    telegramCheckNow.current = telegramCheck
  })

  /** The Telegram card: a failed check first, then what the settings say of the chat. */
  const telegramStatus = (): ConnectionStatus => {
    if (!telegram?.bot) return { state: 'off', message: t('telegram.notSetUp') }
    return connectionStatus(
      telegramCheck,
      () =>
        !telegram.chat
          ? { message: t('telegram.noChat'), warn: true }
          : telegram.refused === 'chat'
            ? { message: t('telegram.chatRefused', { chat: telegram.chat.name }), warn: true }
            : { message: t('telegram.sendsTo', { chat: telegram.chat.name, bot: telegram.bot }) },
      (error) =>
        error instanceof SettingsError && error.code === 'token-rejected' ? t('telegram.tokenRejected') : t('noAnswer.telegram'),
    )
  }

  // Read from this browser, asking the server nothing; only where the server sends push (1.1 and later).
  const push = usePushDevice(notifyLanguage(i18n.resolvedLanguage))

  /** The push card: what this device can do, or what the last action did. */
  const pushStatus = (): ConnectionStatus => {
    const { state, busy, outcome } = push
    // A test says Testing…, as every other card's.
    if (!state || busy) return { state: 'loading', message: busy === 'on' ? t('push.turningOn') : busy === 'off' ? t('push.turningOff') : undefined }
    if (outcome && !outcome.ok) return { state: 'error', message: outcome.message }
    if (state.kind === 'on') return { state: 'ok', message: outcome?.message ?? t('push.on') }
    if (state.kind === 'denied') return { state: 'warn', message: t('push.denied') }
    if (state.kind === 'off') return { state: 'off', message: outcome?.message ?? t('push.off') }
    return { state: 'off', message: t(`push.${state.kind === 'install' ? 'install' : state.kind === 'unsupported' ? 'unsupported' : 'needsHttps'}`) }
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
            status={connectionStatus(qbittorrent, () => ({ message: t('settings.connected') }), (error) => failureText(t, 'qbittorrent', failureOf(error)) ?? t('noAnswer.qbittorrent', { context: unreachableText(unreachable(error)) }))}
            onTest={qbittorrent.retry}
            editLabel={qbittorrentFromApp ? t('settings.changeQbittorrent') : undefined}
            onEdit={() => setEditingQbittorrent(true)}
          />
          <ConnectionRow
            name="Prowlarr"
            icon="search"
            status={connectionStatus(
              prowlarr,
              // Search finds nothing without indexers, so the card warns rather than only connects.
              ({ indexers }) =>
                indexers === 0 ? { message: t('settings.connectedNoIndexers'), warn: true } : { message: t('settings.connected') },
              (error) =>
                error instanceof ProwlarrSetupError ? t('settings.prowlarrSetup') : (failureText(t, 'prowlarr', failureOf(error)) ?? t('noAnswer.prowlarr')),
            )}
            onTest={prowlarr.retry}
            editLabel={t('prowlarrKey.change', { context: prowlarrFromApp ? 'address' : undefined })}
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
          {/* A server before 1.1 has no notifications: no card. */}
          {server?.telegram && (
            <ConnectionRow
              name="Telegram"
              icon="bell"
              status={telegramStatus()}
              onTest={telegramCheck.retry}
              editLabel={t('telegram.edit')}
              editIcon="settings"
              onEdit={() => setEditingTelegram(true)}
              setUpLabel={t('telegram.setUp')}
            />
          )}
          {server?.push && (
            <ConnectionRow
              name={t('push.name')}
              icon="bell"
              status={pushStatus()}
              busy={!!push.busy}
              onTest={push.state?.kind === 'on' ? push.test : undefined}
              {...(push.state?.kind === 'on'
                ? { editLabel: t('push.turnOff'), editIcon: 'close', onEdit: push.turnOff }
                : push.state?.kind === 'off'
                  ? { setUpLabel: t('push.turnOn'), onEdit: push.turnOn }
                  : push.state?.kind === 'install'
                    ? { setUpLabel: t('install.action'), onEdit: () => setInstallSteps('ios') }
                    : {})}
            />
          )}
        </ul>
        <p className="t-cap c3 settings-hint">{t('settings.connectionsHint', { context: qbittorrentFromApp || prowlarrFromApp ? 'app' : undefined })}</p>
      </Section>

      <Section id="settings-defaults" title={t('settings.downloadDefaults')}>
        <div className="ks-card settings-card">
          {categoryField('movie')}
          {categoryField('tv')}
          {(server?.notifications ? NOTIFY_SWITCHES : DEFAULT_SWITCHES).map((key) => (
            <div key={key} className="settings-toggle">
              <span className="t-body">{t(`add.${key}`)}</span>
              <Toggle label={t(`add.${key}`)} checked={settings[key]} onChange={(on) => update({ [key]: on })} />
            </div>
          ))}
        </div>
        <p className="t-cap c3 settings-hint">{t('settings.defaultsHint')}</p>
        {/* qBittorrent's own, set once: loaded when opened, so the page asks qBittorrent nothing more. */}
        <ul className="ks-card settings-rows">
          <AboutRow icon="folder" label={t('move.known')} hint={t('settings.foldersHint')} onClick={() => setEditingFolders(true)} />
        </ul>
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

      {/* Kinopeer's own login, only when it's on: on Umbrel the login in front is the only one. */}
      {auth?.enabled && (
        <Section id="settings-sign-in" title={t('settings.signIn')}>
          <ul className="ks-card settings-rows">
            {auth.source === 'saved' && (
              <AboutRow
                icon="key"
                label={t('settings.changePassword')}
                hint={t('settings.changePasswordHint')}
                onClick={() => setChangingPassword(true)}
              />
            )}
            <AboutRow
              icon="log-out"
              label={t('settings.signOut')}
              hint={t('settings.signOutHint')}
              onClick={() =>
                void signOut().catch((error: unknown) =>
                  error instanceof AuthError && error.code === 'auth-off'
                    ? loginTurnedOff()
                    : toast.show(t('settings.signOutFailed'), { icon: 'alert' }),
                )
              }
            />
          </ul>
          {auth.source === 'env' && <p className="t-cap c3 settings-hint">{t('settings.passwordFromEnv')}</p>}
        </Section>
      )}

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
      <FoldersSheet open={editingFolders} onClose={() => setEditingFolders(false)} />
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
      <Sheet open={editingTelegram} onClose={() => setEditingTelegram(false)} title={t('telegram.sheetTitle')}>
        {telegram && (
          <TelegramForm
            telegram={telegram}
            onChanged={(changed, saved) => {
              setServerChanged(changed)
              if (saved === 'token') setTelegramVersion((n) => n + 1)
              // A chat or a test that went through shows Telegram answers, which a failed check said it didn't.
              else if (telegramCheckNow.current.error !== undefined) telegramCheckNow.current.retry()
            }}
            onRefused={(refused) => {
              // The page's settings as they are now, not as this render had them: another save may
              // have come in while the test was on its way.
              const latest = sharedRequests.peek<ServerSettings>(SERVER_SETTINGS_KEY, Infinity)?.data ?? server
              if (latest?.telegram) {
                const changed = { ...latest, telegram: { ...latest.telegram, refused } }
                setServerChanged(changed)
                // The refusal's 422 carries no settings, so the page's shared answer learns it here.
                sharedRequests.set<ServerSettings>(SERVER_SETTINGS_KEY, changed)
              }
              // The card names a refused token through its own check, which may have passed before. A refused chat
              // shows Telegram answers (the server asked it which part it refused), which a failed check said it didn't.
              if (refused === 'token' || telegramCheckNow.current.error !== undefined) telegramCheckNow.current.retry()
            }}
            onTurnedOff={(changed) => {
              setServerChanged(changed)
              setEditingTelegram(false)
              toast.show(t('telegram.turnedOff'))
            }}
          />
        )}
      </Sheet>
      <Sheet open={changingPassword} onClose={() => setChangingPassword(false)} title={t('settings.changePassword')}>
        <ChangePasswordForm
          onChanged={() => {
            setChangingPassword(false)
            toast.show(t('settings.passwordChanged'), { icon: 'check' })
          }}
          onLoginOff={loginTurnedOff}
        />
      </Sheet>
      <Sheet
        open={editingQbittorrent}
        onClose={() => setEditingQbittorrent(false)}
        title={t('settings.qbittorrentSheetTitle')}
      >
        <QbittorrentLoginForm
          className="key-form"
          askAddress
          initialAddress={savedUrl(server?.qbittorrent.address)}
          addressFromApp
          onSubmit={async (username, password, url) => {
            setServerChanged(await signIn(username, password, url))
            setEditingQbittorrent(false)
            toast.show(t('settings.qbittorrentSaved'))
            // The row and the categories come from the qBittorrent at the new address.
            qbittorrent.retry()
            setCategoriesLoad((n) => n + 1)
          }}
          onEnvAddress={() => {
            // The environment's address wins now: the row offers no change once the settings say so,
            // and its check runs at that address.
            setEditingQbittorrent(false)
            toast.show(t('connect.envAddress'))
            setServerChanged(null)
            serverLoad.retry()
            qbittorrent.retry()
          }}
        />
      </Sheet>
      <Sheet
        open={editingProwlarrKey}
        onClose={() => setEditingProwlarrKey(false)}
        title={t('prowlarrKey.sheetTitle', { context: prowlarrFromApp ? 'address' : undefined })}
      >
        <ProwlarrKeyForm
          canForget={server?.prowlarr.source === 'saved' && server.prowlarr.serverKey}
          askAddress={prowlarrFromApp}
          initialAddress={savedUrl(server?.prowlarr.address)}
          addressFromApp={server?.prowlarr.address.source === 'saved'}
          onSaved={(changed) => {
            setServerChanged(changed)
            setEditingProwlarrKey(false)
            toast.show(t('prowlarrKey.saved', { context: prowlarrFromApp ? 'address' : undefined }))
            setProwlarrKeyVersion((n) => n + 1)
          }}
          onForgotten={(changed) => {
            setServerChanged(changed)
            setEditingProwlarrKey(false)
            toast.show(t('prowlarrKey.forgotten'))
            setProwlarrKeyVersion((n) => n + 1)
          }}
          // The sheet keeps saying why; the settings asked again stop asking for an address, and
          // the row's check runs at the environment's.
          onEnvAddress={() => {
            setServerChanged(null)
            serverLoad.retry()
            setProwlarrKeyVersion((n) => n + 1)
          }}
        />
      </Sheet>
    </main>
  )
}
