import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useHeightVar } from './useHeightVar'

function Page({ withHeader = true }: { withHeader?: boolean }) {
  const ref = useHeightVar('--head')
  return (
    <main data-testid="main">
      {withHeader && <header ref={ref}>Header</header>}
      <p>Body</p>
    </main>
  )
}

/** jsdom lays nothing out, so the header's height is whatever the test says. */
function headerHeight(height: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height } as DOMRect)
}

describe('useHeightVar', () => {
  it('writes the height on the parent and follows it as it changes', () => {
    let onResize: () => void = () => {}
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          onResize = callback
        }
        observe = observe
        disconnect = disconnect
      },
    )
    headerHeight(160)
    const { getByTestId, rerender, unmount } = render(<Page />)
    const main = getByTestId('main')
    expect(main.style.getPropertyValue('--head')).toBe('160px')
    expect(observe).toHaveBeenCalledWith(main.firstElementChild)

    headerHeight(212)
    act(onResize)
    expect(main.style.getPropertyValue('--head')).toBe('212px')

    rerender(<Page withHeader={false} />)
    expect(disconnect).toHaveBeenCalled()
    expect(main.style.getPropertyValue('--head')).toBe('')
    unmount()
  })

  it('still sets the height once where there is no ResizeObserver', () => {
    headerHeight(120)
    const { getByTestId } = render(<Page />)
    expect(getByTestId('main').style.getPropertyValue('--head')).toBe('120px')
  })
})
