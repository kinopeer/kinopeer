import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubDesktop } from '../lib/stubDesktop'
import { ReleaseName } from './ReleaseName'

const NAME = 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC-FGT'

afterEach(() => vi.unstubAllGlobals())

describe('ReleaseName', () => {
  it('is a button that shows the whole name on a phone', async () => {
    render(<ReleaseName name={NAME} />)
    const button = screen.getByRole('button', { name: NAME })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveClass('ks-clamp2')

    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).not.toHaveClass('ks-clamp2')
  })

  it('is text with the whole name as a tooltip on desktop', () => {
    stubDesktop()
    render(<ReleaseName name={NAME} />)
    expect(screen.getByTitle(NAME)).toHaveTextContent(NAME)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
