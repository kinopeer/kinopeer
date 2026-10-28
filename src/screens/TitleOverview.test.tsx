import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { restoreLayout, stubLayout } from '../lib/stubLayout'
import { TitleOverview } from './TitleOverview'

const TEXT = 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators.'

afterEach(restoreLayout)

describe('TitleOverview', () => {
  it('cuts a long overview and shows the rest on Show more', async () => {
    stubLayout(130, 260)
    render(<TitleOverview text={TEXT} />)
    const text = screen.getByText(TEXT)
    // is-clamped is what cuts the text to five lines (aria-expanded says only whether it's open), and
    // jsdom can't lay the cut out.
    expect(text).toHaveClass('is-clamped')
    expect(screen.getByRole('region', { name: 'Overview' })).toContainElement(text)
    const more = screen.getByRole('button', { name: 'Show more' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(more).toHaveAttribute('aria-controls', text.id)

    await userEvent.click(more)
    expect(text).not.toHaveClass('is-clamped')
    const less = screen.getByRole('button', { name: 'Show less' })
    expect(less).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(less)
    expect(text).toHaveClass('is-clamped')
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument()
  })

  it('has no button when the overview fits', () => {
    stubLayout(78, 78)
    render(<TitleOverview text={TEXT} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('has no button before the text has a size', () => {
    render(<TitleOverview text={TEXT} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
