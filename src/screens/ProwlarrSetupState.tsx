import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SERVER_SETTINGS_FRESH_MS, SERVER_SETTINGS_KEY, getServerSettings } from '../api/settings'
import { EmptyState } from '../components/EmptyState'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useRequest } from '../lib/useRequest'
import { ProwlarrKeyForm } from './ProwlarrKeyForm'

export interface ProwlarrSetupStateProps {
  /** Prowlarr has the server's key and rejected it, rather than the server having no address or key. */
  rejected: boolean
  /** The address or key was saved: search again. */
  onSaved: () => void
}

/**
 * The releases screen's state when the server can't search Prowlarr for want of its address or a
 * key it takes: it says which, and opens the same form as Settings → Connections where the app can
 * set it, so the search runs again without leaving the screen (#510). The server's settings say
 * what the app can set; they're asked for only in this state, sharing the page's answer.
 */
export function ProwlarrSetupState({ rejected, onSaved }: ProwlarrSetupStateProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const server = useRequest(SERVER_SETTINGS_KEY, (signal) => getServerSettings(signal), { freshFor: SERVER_SETTINGS_FRESH_MS })
  const settings = server.data
  const address = settings?.prowlarr.address
  const login = settings?.auth?.enabled === true
  // The address changes from the app only behind Kinopeer's own login and where the environment
  // doesn't set it, as in Settings; without that and without an address, only the server sets it.
  const askAddress = login && address?.source !== 'env'
  const serverOnly = !login && address?.source === null
  // Until the settings answer there's nothing to offer yet; if they don't, the key is (the form says
  // what the server refuses).
  const known = settings !== undefined || server.error !== undefined
  const context = askAddress ? 'address' : undefined

  return (
    <>
      <EmptyState
        icon="key"
        tone="error"
        title={rejected ? t('releases.rejectedTitle') : t('releases.setupTitle')}
        actionLabel={known && !serverOnly ? (rejected ? t('prowlarrKey.change', { context }) : t('releases.setUp')) : undefined}
        actionIcon="key"
        onAction={() => setOpen(true)}
      >
        {known && (serverOnly ? t('prowlarrKey.authOff') : rejected ? t('releases.rejectedBody') : t('releases.setupBody', { context }))}
      </EmptyState>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('prowlarrKey.sheetTitle', { context })}>
        <ProwlarrKeyForm
          askAddress={askAddress}
          initialAddress={address?.source === 'saved' ? address.url : undefined}
          addressFromApp={address?.source === 'saved'}
          onSaved={() => {
            setOpen(false)
            toast.show(t('prowlarrKey.saved', { context }))
            onSaved()
          }}
          // The form says the environment's address wins now; the settings asked again stop asking for one.
          onEnvAddress={server.retry}
        />
      </Sheet>
    </>
  )
}
