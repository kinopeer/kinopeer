import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsError, findAddresses } from '../api/settings'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { SERVICE_NAMES } from '../lib/failureText'

export interface FindAddressProps {
  service: 'qbittorrent' | 'prowlarr'
  /** Puts a found address into the form's field. */
  onPick: (address: string) => void
  /** The server can't take an address from the app (`env-address`, `auth-off`): the form says it as for a save. */
  onRefused: (code: 'env-address' | 'auth-off') => void
}

/**
 * Under a form's address field (#511): asks the server where the service answers, at the usual
 * names and ports and on the server's own network, or in the WebUI build has the page look for
 * Prowlarr itself (#560), and offers each address found to fill the field.
 */
export function FindAddress({ service, onPick, onRefused }: FindAddressProps) {
  const { t } = useTranslation()
  // What the last look found, or that it failed (`unreached`: no answer from Kinopeer's server, whose every answer here has a code); nothing before one.
  const [found, setFound] = useState<string[] | 'failed' | 'unreached'>()
  const [finding, setFinding] = useState(false)
  const running = useRef<AbortController | undefined>(undefined)
  const name = SERVICE_NAMES[service]

  // A form closed while the server or the page looks stops it looking.
  useEffect(() => () => running.current?.abort(), [])

  const find = async () => {
    if (running.current) return
    const controller = new AbortController()
    running.current = controller
    setFinding(true)
    setFound(undefined)
    try {
      setFound(await findAddresses(service, controller.signal))
    } catch (e) {
      const code = e instanceof SettingsError ? e.code : undefined
      if (code === 'env-address' || code === 'auth-off') onRefused(code)
      else setFound(code ? 'failed' : 'unreached')
    }
    running.current = undefined
    setFinding(false)
  }

  return (
    <div className="find-address">
      <Button variant="secondary" size="sm" icon="search" loading={finding} onClick={() => void find()}>
        {t('find.button', { service: name })}
      </Button>
      <div className="find-address-result" role="status">
        {found?.length === 0 && <p className="t-body c2">{t('find.none', { service: name })}</p>}
        {Array.isArray(found) && found.length > 0 && (
          <>
            <p className="t-body c2">{t('find.found')}</p>
            <div className="find-address-list">
              {found.map((address) => (
                <Button key={address} variant="tonal" size="sm" onClick={() => onPick(address)}>
                  {address}
                </Button>
              ))}
            </div>
          </>
        )}
        {/* The status region says the failure, so the banner isn't an alert of its own. */}
        {typeof found === 'string' && (
          <Banner tone="error" live={false}>
            {found === 'failed' ? t('find.failed', { service: name }) : t('common.qbtFailed_kinopeer')}
          </Banner>
        )}
      </div>
    </div>
  )
}
