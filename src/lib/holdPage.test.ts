import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdPage } from './holdPage'
import { stubTouchScreen, swipeMovesPage } from './stubTouchScreen'

let releases: (() => void)[] = []
let frames: FrameRequestCallback[] = []

/** A touch screen, or a mouse without the stub; frames that run only when a test says. */
function stubScreen({ coarse = true } = {}) {
  if (coarse) stubTouchScreen()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
}

const hold = () => {
  const release = holdPage()
  releases.push(release)
  return release
}

const nextFrame = () => {
  const due = frames
  frames = []
  due.forEach((callback) => callback(0))
}

/** A box that scrolls its content, `overflow: auto`, with or without more content than it shows. */
function scroller({ overflowing }: { overflowing: boolean }) {
  const box = document.createElement('div')
  box.style.overflowY = 'auto'
  Object.defineProperty(box, 'clientHeight', { value: 200 })
  Object.defineProperty(box, 'scrollHeight', { value: overflowing ? 600 : 200 })
  const child = document.createElement('p')
  box.append(child)
  document.body.append(box)
  return { box, child }
}

/** A text field inside a sheet's body that shows 100–300px of the screen, the field at `top`. */
function fieldInBody(top: number) {
  const { box } = scroller({ overflowing: true })
  const field = document.createElement('input')
  box.append(field)
  vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 400, 200))
  vi.spyOn(field, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, top - box.scrollTop, 400, 48))
  return { box, field }
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  releases.forEach((release) => release())
  releases = []
  frames = []
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('holdPage', () => {
  it('keeps a swipe outside anything that scrolls off the page', () => {
    stubScreen()
    const backdrop = document.createElement('div')
    document.body.append(backdrop)
    expect(swipeMovesPage(backdrop)).toBe(true)

    hold()
    expect(swipeMovesPage(backdrop)).toBe(false)
  })

  it('lets a swipe scroll a box that has more to show, not one that has nothing to scroll', () => {
    stubScreen()
    hold()
    expect(swipeMovesPage(scroller({ overflowing: true }).child)).toBe(true)
    expect(swipeMovesPage(scroller({ overflowing: false }).child)).toBe(false)
  })

  it('moves a text field out of the page for the frame it gets focus in, so Safari scrolls nothing', () => {
    stubScreen()
    hold()
    const field = document.createElement('input')
    field.style.transform = 'scale(1)'
    document.body.append(field)

    field.focus()
    expect(field.style.transform).toBe('translateY(-2000px)')
    nextFrame()
    expect(field.style.transform).toBe('scale(1)')
  })

  it('leaves a field that opens no keyboard where it is', () => {
    stubScreen()
    hold()
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    document.body.append(checkbox)
    checkbox.focus()
    expect(checkbox.style.transform).toBe('')
  })

  it('then scrolls the field into view in its own box, not the page', () => {
    stubScreen()
    hold()
    const { box, field } = fieldInBody(420)
    field.focus()
    nextFrame()
    expect(box.scrollTop).toBe(168)
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('scrolls the field into view again once the keyboard has shrunk its box', () => {
    const viewport = new EventTarget()
    vi.stubGlobal('visualViewport', viewport)
    stubScreen()
    hold()
    const { box, field } = fieldInBody(200)
    field.focus()
    nextFrame()
    expect(box.scrollTop).toBe(0)

    vi.mocked(box.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 400, 80))
    viewport.dispatchEvent(new Event('resize'))
    expect(box.scrollTop).toBe(68)
  })

  it('puts the page back when it scrolls anyway', () => {
    stubScreen()
    hold()
    window.dispatchEvent(new Event('scroll'))
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('holds until every hold is released', () => {
    stubScreen()
    const backdrop = document.createElement('div')
    document.body.append(backdrop)
    const first = hold()
    const second = hold()

    first()
    first()
    expect(swipeMovesPage(backdrop)).toBe(false)
    second()
    expect(swipeMovesPage(backdrop)).toBe(true)
  })

  it('does nothing under a mouse', () => {
    stubScreen({ coarse: false })
    hold()
    const backdrop = document.createElement('div')
    const field = document.createElement('input')
    document.body.append(backdrop, field)
    expect(swipeMovesPage(backdrop)).toBe(true)
    field.focus()
    expect(field.style.transform).toBe('')
  })
})
