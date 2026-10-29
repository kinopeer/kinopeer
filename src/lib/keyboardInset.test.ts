import { afterEach, describe, expect, it, vi } from 'vitest'
import { keyboardArea, trackKeyboardInset } from './keyboardInset'

const root = document.documentElement
let stop: (() => void) | undefined

afterEach(() => {
  stop?.()
  vi.unstubAllGlobals()
})

describe('keyboardArea', () => {
  it('is the page above the keyboard, its inset the layout viewport below it', () => {
    expect(keyboardArea({ layoutHeight: 844, height: 508, offsetTop: 0, scale: 1 })).toEqual({ inset: 336, top: 0, height: 508 })
  })

  it('leaves out of the inset what the browser scrolled the visual viewport down by', () => {
    expect(keyboardArea({ layoutHeight: 844, height: 508, offsetTop: 120, scale: 1 })).toEqual({ inset: 216, top: 120, height: 508 })
  })

  it('stays with an inset of 0 when the browser scrolled the page to its end', () => {
    expect(keyboardArea({ layoutHeight: 844, height: 508, offsetTop: 336, scale: 1 })).toEqual({ inset: 0, top: 336, height: 508 })
  })

  it('keeps the inset at 0 when the page bounces past its end', () => {
    expect(keyboardArea({ layoutHeight: 844, height: 508, offsetTop: 350, scale: 1 })?.inset).toBe(0)
  })

  it('is null without a keyboard', () => {
    expect(keyboardArea({ layoutHeight: 844, height: 844, offsetTop: 0, scale: 1 })).toBeNull()
  })

  it('is null when pinch zoom shrank the visual viewport', () => {
    expect(keyboardArea({ layoutHeight: 844, height: 422, offsetTop: 0, scale: 2 })).toBeNull()
  })

  it('rounds a fraction of a pixel, the height down so it fits', () => {
    expect(keyboardArea({ layoutHeight: 844, height: 507.6, offsetTop: 0.4, scale: 1 })).toEqual({ inset: 336, top: 0, height: 507 })
    expect(keyboardArea({ layoutHeight: 844, height: 843.7, offsetTop: 0, scale: 1 })).toBeNull()
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

  it('keeps the visible part when the browser scrolled the page under the keyboard to its end', () => {
    const { viewport, resize } = stubVisualViewport()
    stop = trackKeyboardInset()
    resize(508)
    viewport.offsetTop = 336
    viewport.dispatchEvent(new Event('scroll'))
    expect(inset()).toBe('0px')
    expect(visible()).toEqual(['336px', '508px'])
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
