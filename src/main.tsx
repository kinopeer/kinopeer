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
import { ROUTER_OPTIONS } from './lib/routerOptions'
import { listenForInstallPrompt } from './pwa/install'
import { startProxySignIn } from './pwa/proxySignIn'
import { startUpdateChecks } from './pwa/updates'
import { ErrorBoundary } from './screens/ErrorBoundary'
import { getLanguagePreference, initLanguage, onLanguageUnavailable, resolveLanguage, showLanguage } from './i18n/language'
import { initSettingsSync } from './settings/settings'
import { initTheme } from './theme/theme'

// Before anything reads the address or sends a request: the app routes it without the proxy's
// parameter, and a request a sign-in proxy redirects loads the page through it.
startProxySignIn()
initTheme()
initLanguage()
initSettingsSync()
listenForInstallPrompt()
// A page an update left behind finds its build's language files gone: the check reloads it into the new build.
const updates = startUpdateChecks()
onLanguageUnavailable(() => void updates.check())
trackInputModality()
trackKeyboardInset()

// The first render waits for the texts of the language it shows, so neither the keys nor another
// language flash first. Without them (the file unreachable) it renders anyway, with the keys.
void showLanguage(resolveLanguage(getLanguagePreference())).then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter {...ROUTER_OPTIONS}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </StrictMode>,
  ),
)
