import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Accordion, type AccordionProps } from './Accordion'

function Options(props: Partial<AccordionProps>) {
  const [open, setOpen] = useState(false)
  return (
    <Accordion title="Options" open={open} onOpenChange={setOpen} {...props}>
      <p>Save path</p>
    </Accordion>
  )
}

describe('Accordion', () => {
  it('renders what’s under it only while open, and says so on the toggle', async () => {
    render(<Options />)
    const toggle = screen.getByRole('button', { name: 'Options' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Save path')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toHaveTextContent('Save path')

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Save path')).not.toBeInTheDocument()
  })

  it('is a region of the page named by its toggle, which sits in a heading, when it has one', () => {
    render(<Options heading />)
    const region = screen.getByRole('region', { name: 'Options' })
    expect(within(region).getByRole('heading', { level: 2, name: 'Options' })).toContainElement(
      within(region).getByRole('button', { name: 'Options' }),
    )
  })

  it('is neither a region nor a heading without one', () => {
    render(<Options />)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})
