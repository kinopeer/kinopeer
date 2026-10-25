import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { trackInputModality } from './inputModality'

const root = document.documentElement
let stop: (() => void) | undefined

afterEach(() => stop?.())

describe('trackInputModality', () => {
  it('marks pointer input until the next key press', () => {
    stop = trackInputModality()
    expect(root.dataset.input).toBeUndefined()

    fireEvent.pointerDown(document.body)
    expect(root.dataset.input).toBe('pointer')

    fireEvent.keyDown(document.body, { key: 'Tab' })
    expect(root.dataset.input).toBeUndefined()
  })

  it('ignores shortcuts with modifier keys', () => {
    stop = trackInputModality()
    fireEvent.pointerDown(document.body)
    fireEvent.keyDown(document.body, { key: 'Tab', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true })
    expect(root.dataset.input).toBe('pointer')
  })

  it('stops listening and clears the mark', () => {
    stop = trackInputModality()
    fireEvent.pointerDown(document.body)
    stop()
    expect(root.dataset.input).toBeUndefined()
    fireEvent.pointerDown(document.body)
    expect(root.dataset.input).toBeUndefined()
  })
})
