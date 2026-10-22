import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/EmptyState'

function CrashScreen() {
  const { t } = useTranslation()
  return (
    <main className="screen home">
      <EmptyState
        icon="alert"
        tone="error"
        title={t('crash.title')}
        actionLabel={t('crash.reload')}
        actionIcon="refresh"
        onAction={() => window.location.reload()}
      >
        {t('crash.body')}
      </EmptyState>
    </main>
  )
}

interface ErrorBoundaryProps {
  children: ReactNode
}

/** Shows a crash screen with a Reload button instead of a blank page when rendering throws. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    return this.state.failed ? <CrashScreen /> : this.props.children
  }
}
