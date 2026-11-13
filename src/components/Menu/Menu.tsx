import { useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import { Popover, type PopoverProps } from '../Popover'
import './Menu.css'

export interface MenuProps {
  /** The button that opened the menu: the menu sits under it (above, if there's no room) and focus returns to it. */
  anchor: HTMLElement
  /** Accessible name of the menu. */
  label: string
  onClose: () => void
  /** Menu items: MenuItem, MenuItemRadio, MenuLink, MenuDivider. */
  children: ReactNode
  /** Under the items, outside the menu itself, e.g. an error message. */
  footer?: ReactNode
  /** Which edge of the anchor it lines up with: the right one unless the anchor sits on the left. */
  align?: PopoverProps['align']
  /** For an anchor in a sticky bar: the menu follows it on a scroll or a resize instead of closing. */
  follow?: PopoverProps['follow']
  className?: string
}

const ITEMS = '[role^="menuitem"]:not(:disabled)'

/**
 * A desktop popover menu, lined up with the right edge of its anchor by default. The checked item,
 * else the first one, gets focus;
 * arrow keys, Home and End move between items. Tab closes it and returns focus to the anchor; the
 * rest of closing is Popover's.
 */
export function Menu({ anchor, label, onClose, children, footer, align, follow, className }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  // After Popover's own layout effect, so the menu is in place before it takes the focus.
  useLayoutEffect(() => {
    const menu = ref.current
    const item = menu?.querySelector<HTMLElement>(`${ITEMS}[aria-checked="true"]`) ?? menu?.querySelector<HTMLElement>(ITEMS)
    item?.focus({ preventScroll: true })
  }, [anchor])

  const onKeyDown = (event: KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])]
    const index = items.indexOf(document.activeElement as HTMLElement)
    const focus = (next: number) => items[(next + items.length) % items.length]?.focus()
    switch (event.key) {
      case 'ArrowDown':
        focus(index + 1)
        break
      case 'ArrowUp':
        focus(index < 0 ? -1 : index - 1)
        break
      case 'Home':
        focus(0)
        break
      case 'End':
        focus(-1)
        break
      case 'Tab':
        onClose()
        anchor.focus()
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <Popover anchor={anchor} onClose={onClose} align={align} follow={follow} className={cx('ks-menu-pop', className)} onKeyDown={onKeyDown}>
      <div ref={ref} role="menu" aria-label={label} className="ks-menu">
        {children}
      </div>
      {footer}
    </Popover>
  )
}

interface ItemContent {
  icon?: IconName
  children: ReactNode
}

export interface MenuItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>, ItemContent {
  danger?: boolean
  /** In the accent: the item worth picking now, e.g. what a button's `dot` points at. */
  highlight?: boolean
  /** Under the label, dimmed, as the item's description: e.g. why it's off. */
  hint?: string
}

export function MenuItem({ icon, danger, highlight, hint, children, className, ...rest }: MenuItemProps) {
  const hintId = useId()
  return (
    <button
      {...rest}
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-describedby={hint ? hintId : undefined}
      className={cx('ks-menu-item', danger && 'is-danger', highlight && 'is-highlight', className)}
    >
      {icon && <Icon name={icon} size={18} />}
      {hint ? (
        <span className="ks-row-text">
          <span>{children}</span>
          <span id={hintId} className="ks-row-hint" aria-hidden="true">
            {hint}
          </span>
        </span>
      ) : (
        children
      )}
    </button>
  )
}

export interface MenuItemRadioProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  checked: boolean
  label: string
  /** After the label, dimmed, e.g. what the option means. */
  hint?: string
}

/** One of a set of options: checked shows a tick. */
export function MenuItemRadio({ checked, label, hint, className, ...rest }: MenuItemRadioProps) {
  return (
    <button
      {...rest}
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      className={cx('ks-menu-item', className)}
    >
      <span className="ks-menu-label">{label}</span>
      {hint && (
        <span className="t-cap c3" aria-hidden="true">
          {hint}
        </span>
      )}
      <Icon name="check" size={18} strokeWidth={2.4} className={cx('ca ks-menu-check', !checked && 'is-off')} />
    </button>
  )
}

export interface MenuLinkProps extends ItemContent {
  to: string
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
}

export function MenuLink({ to, icon, onClick, children }: MenuLinkProps) {
  return (
    <Link to={to} role="menuitem" tabIndex={-1} className="ks-menu-item" onClick={onClick}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </Link>
  )
}

export function MenuDivider() {
  return <div role="separator" className="ks-divider ks-menu-divider" />
}
