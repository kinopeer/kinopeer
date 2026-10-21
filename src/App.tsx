import { useTranslation } from 'react-i18next'
import { ConnectScreen } from './screens/ConnectScreen'
import { HomeScreen } from './screens/HomeScreen'
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
      return <HomeScreen version={session.version} onSignOut={() => void signOut()} />
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
