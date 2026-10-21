import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes } from 'react-router'
import { TabBar, type TabBarItem } from './components/TabBar'
import { ConnectScreen } from './screens/ConnectScreen'
import { DownloadsScreen } from './screens/DownloadsScreen'
import { ReleasesScreen } from './screens/ReleasesScreen'
import { SearchScreen } from './screens/SearchScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TitleScreen } from './screens/TitleScreen'
import { useQbitSession } from './session/useQbitSession'
import './App.css'

function App() {
  const { t } = useTranslation()
  const { session, recheck, signIn, signOut } = useQbitSession()

  switch (session.status) {
    case 'checking':
      return (
        <main className="screen home" aria-busy="true">
          <span className="screen-spinner" aria-hidden="true" />
          <p className="t-body c2">{t('app.connecting')}</p>
        </main>
      )
    case 'connected': {
      const tabs: TabBarItem[] = [
        { to: '/', icon: 'download', label: t('nav.downloads') },
        { to: '/search', icon: 'search', label: t('nav.search') },
        { to: '/settings', icon: 'settings', label: t('nav.settings') },
      ]
      return (
        <div className="app-shell">
          <Routes>
            <Route index element={<DownloadsScreen onSessionLost={() => void recheck()} />} />
            <Route path="search" element={<SearchScreen />} />
            <Route path="title/:type/:id" element={<TitleScreen />} />
            <Route path="title/:type/:id/releases" element={<ReleasesScreen />} />
            <Route
              path="settings"
              element={<SettingsScreen version={session.version} onSignOut={() => void signOut()} />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <TabBar items={tabs} label={t('nav.label')} />
        </div>
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

export default App
