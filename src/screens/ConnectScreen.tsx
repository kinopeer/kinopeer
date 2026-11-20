import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Unreachable } from '../api/qbittorrent'
import { SERVER_SETTINGS_FRESH_MS, SERVER_SETTINGS_KEY, getServerSettings } from '../api/settings'
import { Button } from '../components/Button'
import { useRequest } from '../lib/useRequest'
import { Preferences } from './Preferences'
import { QbittorrentLoginForm } from './QbittorrentLoginForm'
import { UnreachableState } from './UnreachableState'
import './ConnectScreen.css'

export interface ConnectScreenProps {
  /** Who didn't answer the session check: shown in place of the form, with Retry. */
  unreachable?: Unreachable
  /** The server has no address for qBittorrent: the form asks for one, and a login only where qBittorrent wants one. */
  noAddress?: boolean
  onRetry: () => void
  /** Rejects with a SettingsError saying why the server couldn't log in; `url` only when the form asked for an address. */
  onSignIn: (username: string, password: string, url?: string) => Promise<void>
}

export function ConnectScreen({ unreachable: unreachableProp, noAddress = false, onRetry, onSignIn }: ConnectScreenProps) {
  const { t } = useTranslation()
  // Only an address saved from the app can be changed here, and only behind Kinopeer's own login:
  // the server refuses one otherwise. Not asked while the server itself doesn't answer.
  const settingsKey = noAddress || unreachableProp === 'unreached' || unreachableProp === 'kinopeer' ? null : SERVER_SETTINGS_KEY
  const settings = useRequest(settingsKey, (signal) => getServerSettings(signal), { freshFor: SERVER_SETTINGS_FRESH_MS }).data
  const saved = settings?.auth?.enabled && settings.qbittorrent.address.source === 'saved' ? settings.qbittorrent.address.url : undefined
  const [changing, setChanging] = useState(false)
  // Change shows only with an address saved from the app.
  const askAddress = noAddress || changing

  const changeButton = saved !== undefined && !askAddress && (
    <Button type="button" variant="ghost" size="lg" block onClick={() => setChanging(true)}>
      {t('connect.changeAddress')}
    </Button>
  )

  // The session check got no answer: no login form until there's someone to sign in to, but an
  // address saved from the app can be changed, since a wrong one is why qBittorrent doesn't answer.
  if (unreachableProp && !askAddress) {
    return (
      <main className="screen connect">
        <section className="connect-form connect-unreachable">
          <UnreachableState unreachable={unreachableProp} onRetry={onRetry} texts="connect" />
          {changeButton}
        </section>
        <Preferences />
      </main>
    )
  }

  return (
    <main className="screen connect">
      <QbittorrentLoginForm
        // Change and Cancel start the form afresh: the saved address to edit, no error left.
        key={askAddress ? 'address' : 'login'}
        className="connect-form"
        header={
          <div className="connect-intro">
            <h1 className="t-h1">{t('connect.title')}</h1>
            <p className="t-body c2">{t(askAddress ? 'connect.addressBody' : 'connect.body')}</p>
          </div>
        }
        actions={
          <>
            {changeButton}
            {changing && (
              <Button type="button" variant="ghost" size="lg" block onClick={() => setChanging(false)}>
                {t('common.cancel')}
              </Button>
            )}
          </>
        }
        askAddress={askAddress}
        initialAddress={saved}
        addressFromApp={saved !== undefined}
        onSubmit={onSignIn}
        // The environment's address wins: check the session at it.
        onEnvAddress={onRetry}
        onRetry={onRetry}
      />
      <Preferences />
    </main>
  )
}
