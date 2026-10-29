import { afterEach, describe, expect, it, vi } from 'vitest'
import { keyboardInset, trackKeyboardInset } from './keyboardInset'

const root = document.documentElement
let stop: (() => void) | undefined

afterEach(() => {
  stop?.()
  vi.unstubAllGlobals()
})

describe('keyboardInset', () => {
  it('is the layout viewport below the visual one', () => {
    expect(keyboardInset({ layoutHeight: 844, height: 508, offsetTop: 0, scale: 1 })).toBe(336)
  })

  it('leaves out what the browser scrolled the visual viewport down by', () => {
    expect(keyboardInset({ layoutHeight: 844, height: 508, offsetTop: 120, scale: 1 })).toBe(216)
  })

  it('is 0 without a keyboard', () => {
    expect(keyboardInset({ layoutHeight: 844, height: 844, offsetTop: 0, scale: 1 })).toBe(0)
  })

  it('is 0 when pinch zoom shrank the visual viewport', () => {
    expect(keyboardInset({ layoutHeight: 844, height: 422, offsetTop: 0, scale: 2 })).toBe(0)
  })

  it('is 0 when the visual viewport reaches past the layout viewport', () => {
    expect(keyboardInset({ layoutHeight: 844, height: 844, offsetTop: 12, scale: 1 })).toBe(0)
  })

  it('rounds a fraction of a pixel', () => {
    expect(keyboardInset({ layoutHeight: 844, height: 507.6, offsetTop: 0, scale: 1 })).toBe(336)
    expect(keyboardInset({ layoutHeight: 844, height: 843.7, offsetTop: 0, scale: 1 })).toBe(0)
  })
})

/** A visualViewport that a test resizes, as a keyboard opening does. */
function stubVisualViewport() {
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 })
  vi.stubGlobal('innerHeight', 844)
  vi.stubGlobal('visualViewport', viewport)
  return {
    viewport,
    resize(height: number) {
      viewport.height = height
      viewport.dispatchEvent(new Event('resize'))
    },
  }
}

const inset = () => root.style.getPropertyValue('--keyboard-inset')
const visible = () => [root.style.getPropertyValue('--visible-top'), root.style.getPropertyValue('--visible-height')]

describe('trackKeyboardInset', () => {
  it('keeps the part of the page above the keyboard on <html>', () => {
    const { resize } = stubVisualViewport()
    stop = trackKeyboardInset()
    expect(inset()).toBe('')

    resize(508)
    expect(inset()).toBe('336px')
    expect(visible()).toEqual(['0px', '508px'])

    resize(844)
    expect(inset()).toBe('')
    expect(visible()).toEqual(['', ''])
  })

  it('follows the visual viewport scrolling', () => {
    const { viewport, resize } = stubVisualViewport()
    stop = trackKeyboardInset()
    resize(508)
    viewport.offsetTop = 120
    viewport.dispatchEvent(new Event('scroll'))
    expect(inset()).toBe('216px')
    expect(visible()).toEqual(['120px', '508px'])
  })

  it('stops listening and clears the inset', () => {
    const { resize } = stubVisualViewport()
    stop = trackKeyboardInset()
    resize(508)
    stop()
    expect(inset()).toBe('')
    expect(visible()).toEqual(['', ''])
    resize(400)
    expect(inset()).toBe('')
  })

  it('does nothing without visualViewport', () => {
    vi.stubGlobal('visualViewport', null)
    stop = trackKeyboardInset()
    expect(inset()).toBe('')
  })
})
