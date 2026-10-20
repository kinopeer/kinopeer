import { IconButton } from './components/IconButton'
import type { IconName } from './components/Icon'
import { useTheme } from './theme/useTheme'
import type { ThemePreference } from './theme/theme'
import './App.css'

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'light', label: 'Light', icon: 'sun' },
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
          <IconButton
            key={option.value}
            icon={option.icon}
            label={option.label}
            active={preference === option.value}
            onClick={() => setPreference(option.value)}
          />
        ))}
      </div>
    </main>
  )
}

export default App
