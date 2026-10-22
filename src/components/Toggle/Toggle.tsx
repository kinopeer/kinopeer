import type { ButtonHTMLAttributes } from 'react'
import { cx } from '../../lib/cx'
import './Toggle.css'

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Accessible name; the visible text usually sits next to the switch. */
  label: string
}

/** On/off switch. */
export function Toggle({ checked, onChange, label, className, type = 'button', ...rest }: ToggleProps) {
  return (
    <button
      {...rest}
      type={type}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx('ks-switch', className)}
      onClick={() => onChange(!checked)}
    />
  )
}
