import { describe, expect, it } from 'vitest'
import { clickedOrder, cycledOrder, reversedOrder, usualOrder } from './sortOrder'

const USUAL = { name: false, size: true } as const

describe('usualOrder', () => {
  it('gives a sort its usual direction', () => {
    expect(usualOrder('name', USUAL)).toEqual({ key: 'name', descending: false })
    expect(usualOrder('size', USUAL)).toEqual({ key: 'size', descending: true })
  })
})

describe('clickedOrder', () => {
  it('reverses the current sort', () => {
    expect(clickedOrder({ key: 'size', descending: true }, 'size', USUAL)).toEqual({ key: 'size', descending: false })
    expect(clickedOrder({ key: 'size', descending: false }, 'size', USUAL)).toEqual({ key: 'size', descending: true })
  })

  it('takes another sort in its usual direction, whatever the current one is in', () => {
    expect(clickedOrder({ key: 'name', descending: true }, 'size', USUAL)).toEqual({ key: 'size', descending: true })
    expect(clickedOrder({ key: 'size', descending: true }, 'name', USUAL)).toEqual({ key: 'name', descending: false })
    expect(clickedOrder({ key: 'size', descending: false }, 'name', USUAL)).toEqual({ key: 'name', descending: false })
  })
})

describe('reversedOrder', () => {
  it('keeps the sort and turns its direction', () => {
    expect(reversedOrder({ key: 'name', descending: false })).toEqual({ key: 'name', descending: true })
    expect(reversedOrder({ key: 'size', descending: true })).toEqual({ key: 'size', descending: false })
  })
})

describe('cycledOrder', () => {
  const KEYS = ['name', 'size'] as const

  it('turns a sort in its usual direction the other way', () => {
    expect(cycledOrder({ key: 'name', descending: false }, KEYS, USUAL)).toEqual({ key: 'name', descending: true })
    expect(cycledOrder({ key: 'size', descending: true }, KEYS, USUAL)).toEqual({ key: 'size', descending: false })
  })

  it('goes on from a reversed sort to the next one in its usual direction, and from the last to the first', () => {
    expect(cycledOrder({ key: 'name', descending: true }, KEYS, USUAL)).toEqual({ key: 'size', descending: true })
    expect(cycledOrder({ key: 'size', descending: false }, KEYS, USUAL)).toEqual({ key: 'name', descending: false })
  })
})
