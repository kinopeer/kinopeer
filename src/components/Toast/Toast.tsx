import { useEffect } from 'react'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import './Toast.css'

export interface ToastProps {
  message: string
  icon?: IconName
  /** Called once the toast has been shown for `duration` ms. */
  onDismiss: () => void
  duration?: number
  className?: string
}

/** How long a toast shows, in ms. */
export const TOAST_DURATION = 4000

/** A short confirmation above the tab bar, announced politely to screen readers. */
export function Toast({ message, icon, onDismiss, duration = TOAST_DURATION, className }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration)
    return () => clearTimeout(timer)
  }, [message, onDismiss, duration])

  return <ToastView message={message} icon={icon} className={className} />
}

/** A toast's look alone, for `ToastProvider`, which keeps the time itself. */
export function ToastView({ message, icon = 'check', className }: Pick<ToastProps, 'message' | 'icon' | 'className'>) {
  return (
    <div className={cx('ks-toast', className)} role="status">
      <Icon name={icon} />
      <span>{message}</span>
    </div>
  )
}
