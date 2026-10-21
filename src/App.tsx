import { useTranslation } from 'react-i18next'
import { ConnectScreen } from './screens/ConnectScreen'
import { DownloadsScreen } from './screens/DownloadsScreen'
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
    case 'connected':
      return (
        <DownloadsScreen
          version={session.version}
          onSignOut={() => void signOut()}
          onSessionLost={() => void recheck()}
        />
      )
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
