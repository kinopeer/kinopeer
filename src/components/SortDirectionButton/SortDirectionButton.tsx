import { useTranslation } from 'react-i18next'
import { cx } from '../../lib/cx'
import { IconButton, type IconButtonProps } from '../IconButton'
import './SortDirectionButton.css'

export interface SortDirectionButtonProps {
  /** The list's direction, which the button names and its icon shows. */
  descending: boolean
  /** The button was pressed: the list goes the other way. */
  onReverse: () => void
  size?: IconButtonProps['size']
}

/** Reverses a sort beside its picker: named by the direction the list is in, its icon upside down for ascending. */
export function SortDirectionButton({ descending, onReverse, size }: SortDirectionButtonProps) {
  const { t } = useTranslation()
  return (
    <IconButton
      icon="sort-desc"
      variant="filled"
      size={size}
      label={t(descending ? 'common.descending' : 'common.ascending')}
      className={cx('ks-sort-direction', !descending && 'is-ascending')}
      onClick={onReverse}
    />
  )
}
