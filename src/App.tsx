import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { Sidebar, SidebarStatus, type SidebarItem } from './components/Sidebar'
import { TabBar, type TabBarItem } from './components/TabBar'
import { Toast } from './components/Toast'
import { backgroundOf } from './lib/background'
import { useIsDesktop } from './lib/useIsDesktop'
import { ConnectScreen } from './screens/ConnectScreen'
import { DownloadsScreen } from './screens/DownloadsScreen'
import { DownloadsWithDrawer } from './screens/DownloadsWithDrawer'
import { ErrorBoundary } from './screens/ErrorBoundary'
import { SearchScreen } from './screens/SearchScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TitleRoute } from './screens/TitleScreen'
import { TmdbKeyScreen } from './screens/TmdbKeyScreen'
import { TorrentDrawerOverPage } from './screens/TorrentDrawer'
import { TorrentScreen } from './screens/TorrentScreen'
import { useQbitSession } from './session/useQbitSession'
import { useTmdbSetup } from './session/useTmdbSetup'
import { freeSpace } from './torrents/freeSpace'
import { downloadStatus } from './torrents/status'
import { useAltSpeedLimits } from './torrents/useAltSpeedLimits'
import { MainDataProvider } from './torrents/MainDataProvider'
import { useMainData } from './torrents/useMainData'
import './App.css'

function App() {
  const { t } = useTranslation()
  const { session, recheck, signIn } = useQbitSession()
  const tmdb = useTmdbSetup(session.status === 'connected')
  const location = useLocation()
  const isDesktop = useIsDesktop()
  // Selecting downloads puts the selection's actions in place of the tab bar. The sidebar stays.
  const [selecting, setSelecting] = useState(false)

  const connecting = (
    <main className="screen home" aria-busy="true">
      <span className="screen-spinner" aria-hidden="true" />
      <p className="t-body c2">{t('app.connecting')}</p>
    </main>
  )

  switch (session.status) {
    case 'checking':
      return connecting
    case 'connected': {
      if (tmdb.setup === 'checking') return connecting
      if (tmdb.setup === 'needed') return <TmdbKeyScreen onDone={tmdb.finish} onSkip={tmdb.finish} />
      const tabs: TabBarItem[] = [
        { to: '/', icon: 'download', label: t('nav.downloads'), also: ['/torrent/'] },
        { to: '/search', icon: 'search', label: t('nav.search') },
        { to: '/settings', icon: 'settings', label: t('nav.settings') },
      ]
      const onSessionLost = () => void recheck()
      // On desktop a torrent opened from a page (a link's background state) opens in a drawer over
      // that page, which the routes keep rendering. Without one, it opens over Downloads.
      const background =
        isDesktop && location.pathname.startsWith('/torrent/') ? backgroundOf(location) : undefined
      const page = background ?? location
      // A torrent's drawer over Downloads is part of that screen.
      const screenKey = isDesktop && page.pathname.startsWith('/torrent/') ? '/' : page.pathname
      return (
        <MainDataProvider onUnauthorized={onSessionLost}>
          <div className="app-shell">
            {/* Keyed by screen, so a crash on one screen goes away when the user switches tabs. */}
            <ErrorBoundary key={screenKey}>
              {/* Always given a location, so the screens stay mounted when a drawer opens over them. */}
              <Routes location={page}>
                {isDesktop ? (
                  <Route element={<DownloadsWithDrawer onSessionLost={onSessionLost} onSelectingChange={setSelecting} />}>
                    <Route index />
                    <Route path="torrent/:hash" />
                  </Route>
                ) : (
                  <>
                    <Route index element={<DownloadsScreen onSessionLost={onSessionLost} onSelectingChange={setSelecting} />} />
                    <Route path="torrent/:hash" element={<TorrentScreen onSessionLost={onSessionLost} />} />
                  </>
                )}
                <Route path="search" element={<SearchScreen />} />
                <Route path="title/:type/:id" element={<TitleRoute onSessionLost={onSessionLost} />} />
                <Route path="title/:type/:id/releases" element={<TitleRoute onSessionLost={onSessionLost} />} />
                <Route path="settings" element={<SettingsScreen />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ErrorBoundary>
            {background && (
              <Routes>
                <Route
                  path="torrent/:hash"
                  element={<TorrentDrawerOverPage background={background} onSessionLost={onSessionLost} />}
                />
              </Routes>
            )}
            {isDesktop ? (
              <AppSidebar items={tabs} version={session.version} pathname={background?.pathname} />
            ) : (
              !selecting && <TabBar items={tabs} label={t('nav.label')} />
            )}
          </div>
        </MainDataProvider>
      )
    }
    default:
      return (
        <ConnectScreen
          unreachable={session.status === 'unreachable'}
          onRetry={() => void recheck()}
          onSignIn={signIn}
        />
      )
  }
}

/** The desktop sidebar with how many torrents are downloading and qBittorrent's status, from the shared poll. */
function AppSidebar({ items, version, pathname }: { items: TabBarItem[]; version: string; pathname?: string }) {
  const { t } = useTranslation()
  const main = useMainData()
  const { data, offline } = main
  const altSpeed = useAltSpeedLimits(main)
  const downloading = data
    ? Object.values(data.torrents).filter((torrent) => downloadStatus(torrent) === 'downloading').length
    : 0
  const withCount: SidebarItem[] = items.map((item) =>
    item.to === '/' && downloading > 0
      ? { ...item, count: { value: downloading, label: t('nav.downloading', { count: downloading }) } }
      : item,
  )
  return (
    <>
      <Sidebar
        items={withCount}
        label={t('nav.label')}
        pathname={pathname}
        footer={
          <SidebarStatus
            version={version}
            offline={offline}
            downloadSpeed={data?.server.dl_info_speed}
            uploadSpeed={data?.server.up_info_speed}
            freeSpace={freeSpace(data?.server.free_space_on_disk)}
            altSpeedLimits={altSpeed.on}
            altSpeedDisabled={altSpeed.disabled}
            onToggleAltSpeed={altSpeed.toggle}
          />
        }
      />
      {altSpeed.failed && (
        <Toast icon="alert" message={t('speedLimits.failed')} onDismiss={altSpeed.dismissFailed} />
      )}
    </>
  )
}

export default App
