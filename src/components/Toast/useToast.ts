import { createContext, useContext, useEffect, type RefObject } from 'react'
import type { IconName } from '../Icon'

/** The most toasts shown at once; a newer one pushes the oldest out. */
export const MAX_TOASTS = 3

export interface ToastOptions {
  icon?: IconName
}

export interface Toasts {
  /** Shows a toast; the same message again starts its time over, as the newest. */
  show: (message: string, options?: ToastOptions) => void
  /** A modal that opened (a sheet, a dialog, the drawer): toasts show inside it while it's the top one. */
  addLayer: (layer: HTMLElement) => () => void
}

/** The app's toasts, provided by `ToastProvider`. */
export const ToastContext = createContext<Toasts | null>(null)

/** Shows a toast through the app's `ToastProvider`. */
export function useToast(): Toasts['show'] {
  const toasts = useContext(ToastContext)
  if (!toasts) throw new Error('useToast needs a ToastProvider')
  return toasts.show
}

/** Makes a modal the place toasts show in while it's open and the top one. Outside a provider, nothing. */
export function useToastLayer(ref: RefObject<HTMLElement | null>, open = true) {
  const addLayer = useContext(ToastContext)?.addLayer
  useEffect(() => {
    const layer = ref.current
    if (!open || !layer || !addLayer) return
    return addLayer(layer)
  }, [ref, open, addLayer])
}
