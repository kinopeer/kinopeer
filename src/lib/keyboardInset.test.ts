import { afterEach, describe, expect, it, vi } from 'vitest'
import { keyboardArea, trackKeyboardInset } from './keyboardInset'

const root = document.documentElement
let stop: (() => void) | undefined

afterEach(() => {
  stop?.()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
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

/** A field on the page, focused: the keyboard opens only for one. */
function focusField(type = 'text') {
  const field = document.createElement(type === 'textarea' ? 'textarea' : 'input')
  if (field instanceof HTMLInputElement) field.type = type
  document.body.append(field)
  field.focus()
  return field
}

const inset = () => root.style.getPropertyValue('--keyboard-inset')
const open = () => root.style.getPropertyValue('--keyboard-open')
const visible = () => [root.style.getPropertyValue('--visible-top'), root.style.getPropertyValue('--visible-height')]

describe('trackKeyboardInset', () => {
  it('keeps the part of the page above the keyboard on <html>', () => {
    const { resize } = stubVisualViewport()
    focusField()
    stop = trackKeyboardInset()
    expect(inset()).toBe('')

    resize(508)
    expect(inset()).toBe('336px')
    expect(visible()).toEqual(['0px', '508px'])
    expect(open()).toBe('1')

    resize(844)
    expect(inset()).toBe('')
    expect(visible()).toEqual(['', ''])
    expect(open()).toBe('')
  })

  it('follows the visual viewport scrolling', () => {
    const { viewport, resize } = stubVisualViewport()
    focusField()
    stop = trackKeyboardInset()
    resize(508)
    viewport.offsetTop = 120
    viewport.dispatchEvent(new Event('scroll'))
    expect(inset()).toBe('216px')
    expect(visible()).toEqual(['120px', '508px'])
  })

  it('keeps the visible part when the browser scrolled the page under the keyboard to its end', () => {
    const { viewport, resize } = stubVisualViewport()
    focusField()
    stop = trackKeyboardInset()
    resize(508)
    viewport.offsetTop = 336
    viewport.dispatchEvent(new Event('scroll'))
    expect(inset()).toBe('0px')
    expect(visible()).toEqual(['336px', '508px'])
  })

  it('drops it as soon as focus leaves the field, before the browser reports the keyboard gone', () => {
    const { resize } = stubVisualViewport()
    const field = focusField()
    stop = trackKeyboardInset()
    resize(508)
    field.blur()
    expect(inset()).toBe('')
    expect(visible()).toEqual(['', ''])

    field.focus()
    expect(inset()).toBe('336px')
  })

  it('keeps it while focus moves from one field to another', () => {
    const { resize } = stubVisualViewport()
    focusField()
    stop = trackKeyboardInset()
    resize(508)
    focusField()
    expect(inset()).toBe('336px')
  })

  it('counts a text area as a field', () => {
    const { resize } = stubVisualViewport()
    focusField('textarea')
    stop = trackKeyboardInset()
    resize(508)
    expect(inset()).toBe('336px')
  })

  it('leaves it unset while nothing that opens the keyboard has focus', () => {
    const { resize } = stubVisualViewport()
    focusField('checkbox')
    stop = trackKeyboardInset()
    resize(508)
    expect(inset()).toBe('')
  })

  it('stops listening and clears the inset', () => {
    const { resize } = stubVisualViewport()
    focusField()
    stop = trackKeyboardInset()
    resize(508)
    stop()
    expect(inset()).toBe('')
    expect(visible()).toEqual(['', ''])
    resize(400)
    expect(inset()).toBe('')
    // Nor does focus moving to a field touch the page any more.
    root.style.setProperty('--keyboard-inset', '1px')
    focusField()
    expect(inset()).toBe('1px')
  })

  it('does nothing without visualViewport', () => {
    vi.stubGlobal('visualViewport', null)
    stop = trackKeyboardInset()
    expect(inset()).toBe('')
  })
})
