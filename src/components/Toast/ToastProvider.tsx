import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../../lib/cx'
import { TOAST_DURATION, ToastView } from './Toast'
import { MAX_TOASTS, ToastContext, type ToastOptions } from './useToast'

/** How long a toast takes to slide in; a toast shown again after that, in another layer, doesn't. */
const SETTLE_MS = 400

interface Shown extends Omit<ToastOptions, 'key'> {
  id: number
  key: string
  message: string
  /** Done sliding in. */
  settled: boolean
}

/**
 * The app's toasts, a stack of up to `MAX_TOASTS` above the tab bar, each gone after its own time.
 * While a modal is open they show inside the top one: the page outside a modal `<dialog>` is inert,
 * so a toast there would sit behind its backdrop, unread by screen readers. The times are kept here,
 * not in the toasts, since the stack is rendered again in another layer when a modal opens or closes.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Shown[]>([])
  const [layers, setLayers] = useState<HTMLElement[]>([])
  // The toasts as last set, read by show and dismiss, which decide what goes before they set them.
  const shown = useRef<Shown[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>[]>())

  const set = useCallback((next: Shown[]) => {
    shown.current = next
    setToasts(next)
  }, [])
  const forget = useCallback((gone: Shown[]) => {
    for (const toast of gone) {
      timers.current.get(toast.id)?.forEach(clearTimeout)
      timers.current.delete(toast.id)
    }
  }, [])
  const remove = useCallback(
    (drop: (toast: Shown) => boolean) => {
      const gone = shown.current.filter(drop)
      if (gone.length === 0) return
      forget(gone)
      set(shown.current.filter((toast) => !drop(toast)))
    },
    [forget, set],
  )

  const show = useCallback(
    (message: string, { key = message, ...options }: ToastOptions = {}) => {
      nextId.current += 1
      const id = nextId.current
      const same = shown.current.filter((toast) => toast.key === key)
      const next = [...shown.current.filter((toast) => toast.key !== key), { id, key, message, settled: false, ...options }]
      // The same key, and the oldest past the stack's size, go with their times.
      forget([...same, ...next.slice(0, -MAX_TOASTS)])
      set(next.slice(-MAX_TOASTS))
      timers.current.set(id, [
        setTimeout(() => set(shown.current.map((toast) => (toast.id === id ? { ...toast, settled: true } : toast))), SETTLE_MS),
        setTimeout(() => remove((toast) => toast.id === id), TOAST_DURATION),
      ])
    },
    [forget, remove, set],
  )
  const dismiss = useCallback((key: string) => remove((toast) => toast.key === key), [remove])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((ids) => ids.forEach(clearTimeout))
  }, [])

  const addLayer = useCallback((layer: HTMLElement) => {
    setLayers((current) => [...current, layer])
    return () => setLayers((current) => current.filter((item) => item !== layer))
  }, [])
  const value = useMemo(() => ({ show, dismiss, addLayer }), [show, dismiss, addLayer])

  const stack = toasts.length > 0 && (
    <div className="ks-toasts">
      {toasts.map((toast) => (
        <ToastView key={toast.id} message={toast.message} icon={toast.icon} className={cx(toast.settled && 'is-settled')} />
      ))}
    </div>
  )
  // Layers are added as their modals open (effects run child first, as showModal does), so the last
  // one is on top.
  const top = layers.at(-1)
  return (
    <ToastContext value={value}>
      {children}
      {top && stack ? createPortal(stack, top) : stack}
    </ToastContext>
  )
}
