import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { restoreLayout, stubLayout } from '../lib/stubLayout'
import { ReleaseName } from './ReleaseName'

const NAME = 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC-FGT'

afterEach(restoreLayout)

describe('ReleaseName', () => {
  it('is a button that shows the whole name when the name is clipped', async () => {
    stubLayout(36, 54)
    render(<ReleaseName name={NAME} />)
    const button = screen.getByRole('button', { name: NAME })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveClass('ks-clamp2')

    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).not.toHaveClass('ks-clamp2')
  })

  it('is plain text when the name fits', () => {
    stubLayout(36, 36)
    render(<ReleaseName name={NAME} />)
    expect(screen.getByText(NAME)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('counts as clipped before it has a size', () => {
    render(<ReleaseName name={NAME} />)
    expect(screen.getByRole('button', { name: NAME })).toBeInTheDocument()
  })
})
