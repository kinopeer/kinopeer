import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Toast } from './Toast'
import { MAX_TOASTS, ToastContext, type ToastOptions } from './useToast'

interface Shown extends ToastOptions {
  id: number
  message: string
}

/**
 * The app's toasts, a stack of up to `MAX_TOASTS` above the tab bar, each gone after its own time.
 * While a modal is open they show inside the top one: the page outside a modal `<dialog>` is inert,
 * so a toast there would sit behind its backdrop, unread by screen readers.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Shown[]>([])
  const [layers, setLayers] = useState<HTMLElement[]>([])
  const nextId = useRef(0)

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    nextId.current += 1
    const id = nextId.current
    setToasts((current) =>
      [...current.filter((toast) => toast.message !== message), { id, message, ...options }].slice(-MAX_TOASTS),
    )
  }, [])
  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])
  const addLayer = useCallback((layer: HTMLElement) => {
    setLayers((current) => [...current, layer])
    return () => setLayers((current) => current.filter((item) => item !== layer))
  }, [])
  const value = useMemo(() => ({ show, addLayer }), [show, addLayer])

  const stack = toasts.length > 0 && (
    <div className="ks-toasts">
      {toasts.map((toast) => (
        <ShownToast key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  )
  const top = layers.at(-1)
  return (
    <ToastContext value={value}>
      {children}
      {top && stack ? createPortal(stack, top) : stack}
    </ToastContext>
  )
}

function ShownToast({ toast, onDismiss }: { toast: Shown; onDismiss: (id: number) => void }) {
  const dismiss = useCallback(() => onDismiss(toast.id), [onDismiss, toast.id])
  return <Toast message={toast.message} icon={toast.icon} onDismiss={dismiss} />
}
