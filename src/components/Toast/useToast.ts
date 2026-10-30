import { createContext, useContext, useEffect, type RefObject } from 'react'
import type { IconName } from '../Icon'

/** The most toasts shown at once; a newer one pushes the oldest out. */
export const MAX_TOASTS = 3

export interface ToastOptions {
  icon?: IconName
  /** What the toast is about, the message by default: a toast with the same key replaces it, and
   *  `dismiss` takes it back (a failure, once the action it reports is tried again). */
  key?: string
}

export interface Toasts {
  /** Shows a toast as the newest, in place of one with the same key, its time starting over. */
  show: (message: string, options?: ToastOptions) => void
  /** Takes back the toast with this key, if it still shows. */
  dismiss: (key: string) => void
}

export interface ToastLayers {
  /** A modal that opened (a sheet, a dialog, the drawer): toasts show inside it while it's the top one. */
  addLayer: (layer: HTMLElement) => () => void
}

/** The app's toasts, provided by `ToastProvider`. */
export const ToastContext = createContext<(Toasts & ToastLayers) | null>(null)

/** Shows and takes back toasts through the app's `ToastProvider`. */
export function useToast(): Toasts {
  const toasts = useContext(ToastContext)
  if (!toasts) throw new Error('useToast needs a ToastProvider')
  return toasts
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
