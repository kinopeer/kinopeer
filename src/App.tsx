import { useTheme } from './theme/useTheme'
import type { ThemePreference } from './theme/theme'
import './App.css'

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

function App() {
  const { preference, setPreference } = useTheme()

  return (
    <main className="app">
      <h1 className="t-display">
        kino<span className="app-wordmark-accent">seed</span>
      </h1>
      <p className="t-body-lg c2">Movies and TV series for qBittorrent.</p>
      <div className="app-theme" role="group" aria-label="Theme">
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="t-label"
            aria-pressed={preference === option.value}
            onClick={() => setPreference(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </main>
  )
}

export default App
