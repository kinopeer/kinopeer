import { cx } from '../../lib/cx'
import type { SortOrder } from '../../lib/sortOrder'
import { Icon } from '../Icon'
import './SortHeader.css'

export interface SortHeaderProps<Key extends string> {
  /** The sort this column's name picks. */
  sort: Key
  /** The table's order, which the header of its column shows. */
  order: SortOrder<Key>
  /** The header was clicked. */
  onSort: (sort: Key) => void
  /** Follows the visible name for screen readers, hidden, where the name alone says little ("#"). */
  label?: string
  className?: string
  /** The column's visible name. */
  children: string
}

/** A sortable column's header: a button, with an arrow and `aria-sort` while the table is in its order. */
export function SortHeader<Key extends string>({ sort, order, onSort, label, className, children }: SortHeaderProps<Key>) {
  const sorted = order.key === sort
  const direction = order.descending ? 'descending' : 'ascending'
  return (
    <span role="columnheader" className={className} aria-sort={sorted ? direction : undefined}>
      <button type="button" className={cx('ks-sort-header', sorted && 'is-on')} onClick={() => onSort(sort)}>
        {children}
        {/* After the visible text rather than in place of it, so voice control finds the button by what it shows. */}
        {/* The space outside the span: whitespace inside it is trimmed from the name. A whitespace-only
            flex item isn't rendered, so the gap stays as it is. */}
        {label && (
          <>
            {' '}
            <span className="sr-only">{label}</span>
          </>
        )}
        {sorted && <Icon name={order.descending ? 'arrow-down' : 'arrow-up'} size={14} strokeWidth={2.4} />}
      </button>
    </span>
  )
}
