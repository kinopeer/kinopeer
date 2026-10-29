import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdPage } from './holdPage'
import { stubDesktop } from './stubDesktop'
import { stubTouchScreen, swipeMovesPage } from './stubTouchScreen'

let releases: (() => void)[] = []
let frames: FrameRequestCallback[] = []

/** A touch screen, or a desktop's mouse; frames that run only when a test says. */
function stubScreen({ coarse = true } = {}) {
  if (coarse) stubTouchScreen()
  else stubDesktop()
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

/**
 * A box that scrolls its content along an axis (`overflow-y: auto` by default), with or without
 * more content than it shows, inside `parent` (the page's body by default).
 */
function scroller({ overflowing, axis = 'y', parent = document.body }: { overflowing: boolean; axis?: 'x' | 'y'; parent?: Element }) {
  const box = document.createElement('div')
  const [client, scroll] = axis === 'y' ? ['clientHeight', 'scrollHeight'] : ['clientWidth', 'scrollWidth']
  box.style[axis === 'y' ? 'overflowY' : 'overflowX'] = 'auto'
  Object.defineProperty(box, client, { value: 200 })
  Object.defineProperty(box, scroll, { value: overflowing ? 600 : 200 })
  const child = document.createElement('p')
  box.append(child)
  parent.append(box)
  return { box, child }
}

/** A text field inside a sheet's body that shows 100–300px of the screen, the field at `top`. */
function fieldInBody(top: number, height = 48) {
  const { box } = scroller({ overflowing: true })
  const field = document.createElement('input')
  box.append(field)
  vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 400, 200))
  vi.spyOn(field, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, top - box.scrollTop, 400, height))
  return { box, field }
}

/** The sheet's body shrinks to 100–180px of the screen, as the keyboard opening does. */
function shrink(box: HTMLElement, viewport: EventTarget) {
  vi.mocked(box.getBoundingClientRect).mockReturnValue(new DOMRect(0, 100, 400, 80))
  viewport.dispatchEvent(new Event('resize'))
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

  it('scrolls a box only along the way it has more to show', () => {
    stubScreen()
    hold()
    const row = scroller({ overflowing: true, axis: 'x' }).child
    expect(swipeMovesPage(row, { dx: -50, dy: 0 })).toBe(true)
    expect(swipeMovesPage(row, { dx: 0, dy: -50 })).toBe(false)
  })

  it('scrolls the box around one that has nothing to show', () => {
    stubScreen()
    hold()
    const body = scroller({ overflowing: true }).box
    expect(swipeMovesPage(scroller({ overflowing: false, parent: body }).child)).toBe(true)
  })

  it('still zooms with two fingers', () => {
    stubScreen()
    hold()
    const backdrop = document.createElement('div')
    document.body.append(backdrop)
    expect(swipeMovesPage(backdrop, { fingers: 2 })).toBe(true)
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

  it('puts a field focused again before that frame back where it was', () => {
    stubScreen()
    hold()
    const field = document.createElement('input')
    document.body.append(field)

    field.focus()
    field.blur()
    field.focus()
    nextFrame()
    expect(field.style.transform).toBe('')
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

  it('scrolls its box back to a field above what it shows', () => {
    stubScreen()
    hold()
    const { box, field } = fieldInBody(150)
    box.scrollTop = 100
    field.focus()
    nextFrame()
    expect(box.scrollTop).toBe(50)
  })

  it('keeps the top of a field taller than its box in view', () => {
    const viewport = new EventTarget()
    vi.stubGlobal('visualViewport', viewport)
    stubScreen()
    hold()
    const { box, field } = fieldInBody(200, 120)
    field.focus()
    nextFrame()
    shrink(box, viewport)
    expect(box.scrollTop).toBe(100)
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

    shrink(box, viewport)
    expect(box.scrollTop).toBe(68)
  })

  it('leaves the box alone when the field lost focus before the keyboard resized it', () => {
    const viewport = new EventTarget()
    vi.stubGlobal('visualViewport', viewport)
    stubScreen()
    hold()
    const { box, field } = fieldInBody(200)
    field.focus()
    nextFrame()
    field.blur()
    shrink(box, viewport)
    expect(box.scrollTop).toBe(0)
  })

  it('puts the page back where it was when the hold began, when it scrolls anyway', () => {
    stubScreen()
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(300)
    hold()
    window.dispatchEvent(new Event('scroll'))
    expect(window.scrollTo).toHaveBeenCalledWith(0, 300)
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
