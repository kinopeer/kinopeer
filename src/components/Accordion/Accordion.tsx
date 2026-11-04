import { useId, type HTMLAttributes, type ReactNode } from 'react'
import { Icon } from '../Icon'
import './Accordion.css'

export interface AccordionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** The toggle's text. */
  title: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A section of a page: the toggle sits in an `h2`, and the section is a region named by it. */
  heading?: boolean
  /** Classes of the body, which wraps the children. */
  bodyClassName?: string
  /** Rendered only while open. */
  children: ReactNode
}

/** A full-width toggle with a chevron that shows or hides what's under it. */
export function Accordion({ title, open, onOpenChange, heading, className, bodyClassName, children, ...rest }: AccordionProps) {
  const id = useId()
  const toggleId = `${id}-toggle`
  const bodyId = `${id}-body`
  const toggle = (
    <button
      type="button"
      id={toggleId}
      className="ks-acc-head"
      aria-expanded={open}
      aria-controls={bodyId}
      onClick={() => onOpenChange(!open)}
    >
      {/* One flex item, so a title of several parts (Files and its count) stays together. */}
      <span>{title}</span>
      <Icon name="chevron-down" />
    </button>
  )
  const body = open && (
    <div id={bodyId} className={bodyClassName}>
      {children}
    </div>
  )

  if (!heading) {
    return (
      <div {...rest} className={className}>
        {toggle}
        {body}
      </div>
    )
  }
  return (
    <section {...rest} aria-labelledby={toggleId} className={className}>
      <h2 className="ks-acc-heading">{toggle}</h2>
      {body}
    </section>
  )
}
