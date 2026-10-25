import { useEffect, useLayoutEffect, useRef, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../Icon'
import './Menu.css'

export interface MenuProps {
  /** The button that opened the menu: the menu sits under it (above, if there's no room) and focus returns to it. */
  anchor: HTMLElement
  /** Accessible name of the menu. */
  label: string
  onClose: () => void
  /** Menu items: MenuItem, MenuItemRadio, MenuLink, MenuGroup, MenuDivider. */
  children: ReactNode
  /** Under the items, outside the menu itself, e.g. an error message. */
  footer?: ReactNode
  className?: string
}

const GAP = 6
const MARGIN = 8
const ITEMS = '[role^="menuitem"]:not(:disabled)'

/**
 * A desktop popover menu (the design system's `ks-pop`), lined up with the right edge of its anchor.
 * The first item gets focus; arrow keys, Home and End move between items. Escape and Tab close it
 * and return focus to the anchor; so does a click outside, a scroll or a resize, without the focus.
 * Rendered in place rather than in a portal, so it works inside a modal dialog too.
 */
export function Menu({ anchor, label, onClose, children, footer, className }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const box = anchor.getBoundingClientRect()
    const { offsetWidth: width, offsetHeight: height } = menu
    const below = box.bottom + GAP
    const top = below + height > window.innerHeight - MARGIN && box.top - GAP - height >= MARGIN ? box.top - GAP - height : below
    const left = Math.max(MARGIN, Math.min(box.right - width, window.innerWidth - width - MARGIN))
    menu.style.top = `${top}px`
    menu.style.left = `${left}px`
    menu.querySelector<HTMLElement>(ITEMS)?.focus({ preventScroll: true })
  }, [anchor])

  useEffect(() => {
    const close = () => onCloseRef.current()
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      // The anchor toggles the menu itself.
      if (!ref.current?.contains(target) && !anchor.contains(target)) close()
    }
    const onScroll = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
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
      case 'Escape':
      case 'Tab':
        // Escape would also close a dialog the menu sits in.
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
    <div ref={ref} className={cx('ks-pop', className)} onKeyDown={onKeyDown}>
      <div role="menu" aria-label={label} className="ks-menu">
        {children}
      </div>
      {footer}
    </div>
  )
}

interface ItemContent {
  icon?: IconName
  children: ReactNode
}

export interface MenuItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>, ItemContent {
  danger?: boolean
}

export function MenuItem({ icon, danger, children, className, ...rest }: MenuItemProps) {
  return (
    <button {...rest} type="button" role="menuitem" tabIndex={-1} className={cx('ks-menu-item', danger && 'is-danger', className)}>
      {icon && <Icon name={icon} size={18} />}
      {children}
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
  onClick?: () => void
}

export function MenuLink({ to, icon, onClick, children }: MenuLinkProps) {
  return (
    <Link to={to} role="menuitem" tabIndex={-1} className="ks-menu-item" onClick={onClick}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </Link>
  )
}

/** Items under a caption, e.g. a question with its answers. */
export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="ks-menu-group">
      <p className="ks-menu-caption t-cap c2" aria-hidden="true">
        {label}
      </p>
      {children}
    </div>
  )
}

export function MenuDivider() {
  return <div role="separator" className="ks-divider ks-menu-divider" />
}
