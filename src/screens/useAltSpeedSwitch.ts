import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../components/Toast'
import { useAltSpeedLimits, type AltSpeedLimits } from '../torrents/useAltSpeedLimits'
import type { MainDataState } from '../torrents/useMainData'
import { TOAST_KEYS } from './toastKeys'

/** The alternative speed limits switch with its failure said in a toast, which the next switch takes back. */
export function useAltSpeedSwitch(main: MainDataState): AltSpeedLimits {
  const { t } = useTranslation()
  const toast = useToast()
  const altSpeed = useAltSpeedLimits(
    main,
    useCallback(() => toast.show(t('speedLimits.failed'), { icon: 'alert', key: TOAST_KEYS.altSpeed }), [toast, t]),
  )
  const { toggle } = altSpeed
  return {
    ...altSpeed,
    toggle: useCallback(() => {
      toast.dismiss(TOAST_KEYS.altSpeed)
      toggle()
    }, [toast, toggle]),
  }
}
