import type { ButtonHTMLAttributes } from 'react'
import { cx } from '../../lib/cx'
import { Icon } from '../Icon'
import './Checkbox.css'

export interface CheckboxProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  /** 'mixed' for a group where only some items are checked. */
  checked: boolean | 'mixed'
  onChange: (checked: boolean) => void
  /** Accessible name; the visible text usually sits next to the box. */
  label: string
}

/** A 44px checkbox button with a 22px box. Checking a mixed box checks everything. */
export function Checkbox({ checked, onChange, label, className, type = 'button', ...rest }: CheckboxProps) {
  return (
    <button
      {...rest}
      type={type}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={cx('ks-check', className)}
      onClick={() => onChange(checked !== true)}
    >
      <span>
        <Icon name="check" size={14} className="ck" />
        <svg className="ks-ic mx" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 12h12" />
        </svg>
      </span>
    </button>
  )
}
