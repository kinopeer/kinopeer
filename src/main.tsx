import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '@fontsource-variable/onest'
import './styles/tokens.css'
import './styles/base.css'
import './i18n'
import App from './App.tsx'
import { listenForInstallPrompt } from './pwa/install'
import { ErrorBoundary } from './screens/ErrorBoundary'

listenForInstallPrompt()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
