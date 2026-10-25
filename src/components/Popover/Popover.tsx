import { useEffect, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import { cx } from '../../lib/cx'
import './Popover.css'

export interface PopoverProps extends HTMLAttributes<HTMLDivElement> {
  /** The button that opened the popover: it sits under it (above, if there's no room) and focus returns to it. */
  anchor: HTMLElement
  onClose: () => void
  /** Which edge of the anchor it lines up with. */
  align?: 'start' | 'end'
  /** Space between the anchor and the popover, in pixels. */
  offset?: number
  /**
   * For an anchor that stays in view, e.g. in a sticky bar: the popover follows it on a scroll or
   * a resize instead of closing.
   */
  follow?: boolean
  children: ReactNode
}

const MARGIN = 8

/**
 * A desktop popover (the design system's `ks-pop`) next to its anchor. Escape closes it and returns
 * focus to the anchor; a click outside, focus moving elsewhere, a scroll or a resize close it without
 * moving the focus. Clicks on the anchor are left to it, so it can toggle the popover. Rendered in
 * place rather than in a portal, so it works inside a modal dialog and keeps the tab order.
 */
export function Popover({ anchor, onClose, align = 'end', offset = 6, follow = false, className, children, ...rest }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const place = useRef(() => {})
  // A followed anchor can move as what's around it changes, e.g. its own label growing.
  useLayoutEffect(() => {
    place.current = () => {
      const popover = ref.current
      if (!popover) return
      const box = anchor.getBoundingClientRect()
      const { offsetWidth: width, offsetHeight: height } = popover
      const below = box.bottom + offset
      const above = box.top - offset - height
      const top = below + height > window.innerHeight - MARGIN && above >= MARGIN ? above : below
      const left = Math.max(MARGIN, Math.min(align === 'end' ? box.right - width : box.left, window.innerWidth - width - MARGIN))
      popover.style.top = `${top}px`
      popover.style.left = `${left}px`
    }
    if (follow) place.current()
  })

  useLayoutEffect(() => {
    place.current()

    const close = () => onCloseRef.current()
    const within = (target: EventTarget | null) => target instanceof Node && !!ref.current?.contains(target)
    const inside = (target: EventTarget | null) => within(target) || (target instanceof Node && anchor.contains(target))
    const onPointerDown = (event: PointerEvent) => {
      if (!inside(event.target)) close()
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!inside(event.target)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Escape would also close a dialog the popover sits in.
      event.preventDefault()
      event.stopPropagation()
      close()
      anchor.focus()
    }
    const onScroll = (event: Event) => {
      if (follow) place.current()
      else if (!within(event.target)) close()
    }
    const onResize = () => (follow ? place.current() : close())
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [anchor, align, offset, follow])

  return (
    <div {...rest} ref={ref} className={cx('ks-pop', className)}>
      {children}
    </div>
  )
}
