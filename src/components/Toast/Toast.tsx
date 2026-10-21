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

/** A short confirmation above the tab bar, announced politely to screen readers. */
export function Toast({ message, icon = 'check', onDismiss, duration = 4000, className }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration)
    return () => clearTimeout(timer)
  }, [message, onDismiss, duration])

  return (
    <div className={cx('ks-toast', className)} role="status">
      <Icon name={icon} />
      <span>{message}</span>
    </div>
  )
}
