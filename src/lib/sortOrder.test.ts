import { describe, expect, it } from 'vitest'
import { clickedOrder, reversedOrder, usualOrder } from './sortOrder'

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
