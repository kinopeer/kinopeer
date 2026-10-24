import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import './Segmented.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: IconName
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name of the group. */
  label: string
  /** Shows only each option's icon; its label becomes the button's accessible name. */
  iconsOnly?: boolean
  className?: string
}

/** One-of-several picker, as a radio group of buttons. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  iconsOnly,
  className,
}: SegmentedProps<T>) {
  return (
    <div className={cx('ks-seg', iconsOnly && 'ks-seg-icons', className)} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={iconsOnly ? option.label : undefined}
          className={cx(option.value === value && 'is-on')}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <Icon name={option.icon} size={16} />}
          {!iconsOnly && option.label}
        </button>
      ))}
    </div>
  )
}
