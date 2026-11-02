import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdPage, pageScrollY } from './holdPage'
import { stubDesktop } from './stubDesktop'
import { stubTouchScreen, swipe, swipeMovesPage } from './stubTouchScreen'

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
  vi.useRealTimers()
  releases.forEach((release) => release())
  releases = []
  frames = []
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
  document.body.removeAttribute('style')
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

  it('keeps the page still under a finger that was already down when the hold began', () => {
    stubScreen()
    hold()
    const body = scroller({ overflowing: true }).child
    expect(swipe(body, [{ dx: 0, dy: -50 }], { down: false })).toEqual([false])
  })

  it('waits for a direction before deciding, so a start too short to have one locks nothing', () => {
    stubScreen()
    hold()
    const row = scroller({ overflowing: true, axis: 'x' }).child
    expect(swipe(row, [{ dx: 0, dy: 0 }, { dx: -50, dy: 0 }])).toEqual([true, true])
    const body = scroller({ overflowing: true }).child
    expect(swipe(body, [{ dx: 1, dy: 0 }, { dx: 1, dy: -50 }])).toEqual([true, true])
  })

  it('keeps even a start too short to have a direction off the page where nothing scrolls', () => {
    stubScreen()
    hold()
    const backdrop = document.createElement('div')
    document.body.append(backdrop)
    expect(swipe(backdrop, [{ dx: 1, dy: 1 }])).toEqual([false])
  })

  it('looks under the first finger, which goes on swiping after a pinch', () => {
    stubScreen()
    hold()
    const backdrop = document.createElement('div')
    document.body.append(backdrop)
    const body = scroller({ overflowing: true }).child
    expect(swipe(backdrop, [{ dx: 0, dy: -50 }], { first: body })).toEqual([true])
  })

  it('keeps a swipe to the direction it first went', () => {
    stubScreen()
    hold()
    const row = scroller({ overflowing: true, axis: 'x' }).child
    expect(swipe(row, [{ dx: 0, dy: 20 }, { dx: 80, dy: 20 }])).toEqual([false, false])
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

  it("keeps a field the keyboard's arrows moved focus to out of the page until Safari has looked", () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { height: 410 }))
    vi.stubGlobal('innerHeight', 714)
    stubScreen()
    hold()
    const field = document.createElement('input')
    document.body.append(field)

    field.focus()
    nextFrame()
    vi.advanceTimersByTime(99)
    expect(field.style.transform).toBe('translateY(-2000px)')
    vi.advanceTimersByTime(1)
    expect(field.style.transform).toBe('')
  })

  it('puts a tapped field back after a frame with the keyboard open', () => {
    vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { height: 410 }))
    vi.stubGlobal('innerHeight', 714)
    stubScreen()
    hold()
    const field = document.createElement('input')
    document.body.append(field)

    swipe(field, [])
    field.focus()
    nextFrame()
    expect(field.style.transform).toBe('')
  })

  it('takes a tap for the focus it led to only', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { height: 410 }))
    vi.stubGlobal('innerHeight', 714)
    stubScreen()
    hold()
    const [first, second] = [document.createElement('input'), document.createElement('input')]
    document.body.append(first, second)

    swipe(first, [])
    first.focus()
    nextFrame()
    second.focus()
    first.focus()
    nextFrame()
    expect(first.style.transform).toBe('translateY(-2000px)')
  })

  it('takes no swipe for a tap', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { height: 410 }))
    vi.stubGlobal('innerHeight', 714)
    stubScreen()
    hold()
    const body = scroller({ overflowing: true }).box
    const field = document.createElement('input')
    body.append(field)

    swipe(field, [{ dx: 0, dy: -50 }])
    field.focus()
    nextFrame()
    expect(field.style.transform).toBe('translateY(-2000px)')
  })

  it('leaves the box alone while the field is out of view, then scrolls it in', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const viewport = Object.assign(new EventTarget(), { height: 410 })
    vi.stubGlobal('visualViewport', viewport)
    vi.stubGlobal('innerHeight', 714)
    stubScreen()
    hold()
    const { box, field } = fieldInBody(420)

    field.focus()
    viewport.dispatchEvent(new Event('resize'))
    expect(box.scrollTop).toBe(0)
    vi.advanceTimersByTime(100)
    expect(box.scrollTop).toBe(168)
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

  it('keeps the window a pixel from the top while a field has focus, the page where it was', () => {
    stubScreen()
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(300)
    hold()
    const field = document.createElement('input')
    document.body.append(field)

    field.focus()
    expect(document.body.style.marginTop).toBe('-299px')
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 1)

    window.dispatchEvent(new Event('scroll'))
    expect(window.scrollTo).toHaveBeenCalledTimes(2)
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 1)
  })

  it('leaves a page at the top where it is, so a field brings no scroll', () => {
    stubScreen()
    hold()
    const field = document.createElement('input')
    document.body.append(field)

    field.focus()
    expect(document.body.style.marginTop).toBe('')
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('leaves the page where it is until a field that opens the keyboard gets focus', () => {
    stubScreen()
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(300)
    hold()
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    document.body.append(checkbox)

    checkbox.focus()
    expect(document.body.style.marginTop).toBe('')
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('takes a field that has focus when the hold begins, as StrictMode\'s second effect run finds it', () => {
    const viewport = new EventTarget()
    vi.stubGlobal('visualViewport', viewport)
    stubScreen()
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(300)
    const release = hold()
    const { box, field } = fieldInBody(200)
    field.focus()
    release()
    expect(document.body.style.marginTop).toBe('')

    hold()
    expect(document.body.style.marginTop).toBe('-299px')

    nextFrame()
    shrink(box, viewport)
    expect(box.scrollTop).toBe(68)
  })

  it('moves the window once, however many fields get focus', () => {
    stubScreen()
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(300)
    const release = hold()
    const [first, second] = [document.createElement('input'), document.createElement('input')]
    document.body.append(first, second)

    first.focus()
    second.focus()
    release()
    expect(document.body.style.marginTop).toBe('')
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 300)
  })

  it('puts the page back once the last hold is released', () => {
    stubScreen()
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(300)
    const release = hold()
    const inner = hold()
    document.body.style.marginTop = '8px'
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()

    inner()
    expect(document.body.style.marginTop).toBe('-299px')
    release()
    expect(document.body.style.marginTop).toBe('8px')
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 300)
  })

  it('still says where the page is while the window is by the top', () => {
    stubScreen()
    const scrollY = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(300)
    const release = hold()
    const field = document.createElement('input')
    document.body.append(field)
    expect(pageScrollY()).toBe(300)

    field.focus()
    scrollY.mockReturnValue(1)
    expect(pageScrollY()).toBe(300)

    release()
    scrollY.mockReturnValue(120)
    expect(pageScrollY()).toBe(120)
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
