import { useId, type InputHTMLAttributes } from 'react'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import './Input.css'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  /** Hint under the field. */
  help?: string
  /** `true` marks the field invalid; a string also replaces the hint with the message. */
  error?: boolean | string
  /** Leading icon. */
  icon?: IconName
  /** Monospace text for URLs, paths and keys. */
  mono?: boolean
}

export function Input({ label, help, error, icon, mono, id, className, ...rest }: InputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const message = typeof error === 'string' ? error : help
  const messageId = message ? `${inputId}-help` : undefined

  const input = (
    <input
      {...rest}
      id={inputId}
      className={cx('ks-input', mono && 't-mono', error && 'is-error', className)}
      aria-invalid={error ? true : undefined}
      aria-describedby={messageId}
    />
  )

  return (
    <div className="ks-field">
      {label && (
        <label className="ks-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      {icon ? (
        <div className="ks-input-wrap">
          <Icon name={icon} size={20} />
          {input}
        </div>
      ) : (
        input
      )}
      {message && (
        <span id={messageId} className={cx('ks-help', error && 'is-error')}>
          {message}
        </span>
      )}
    </div>
  )
}
