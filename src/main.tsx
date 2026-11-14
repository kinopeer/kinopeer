import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '@fontsource-variable/onest'
import './styles/tokens.css'
import './styles/layout.css'
import './styles/base.css'
import './i18n'
import App from './App.tsx'
import { trackInputModality } from './lib/inputModality'
import { trackKeyboardInset } from './lib/keyboardInset'
import { listenForInstallPrompt } from './pwa/install'
import { startProxySignIn } from './pwa/proxySignIn'
import { startUpdateChecks } from './pwa/updates'
import { ErrorBoundary } from './screens/ErrorBoundary'
import { initLanguage } from './i18n/language'
import { initSettingsSync } from './settings/settings'
import { initTheme } from './theme/theme'

// Before anything reads the address or sends a request: the app routes it without the proxy's
// parameter, and a request a sign-in proxy redirects loads the page through it.
startProxySignIn()
initTheme()
initLanguage()
initSettingsSync()
listenForInstallPrompt()
startUpdateChecks()
trackInputModality()
trackKeyboardInset()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
