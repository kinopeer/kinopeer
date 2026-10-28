import { describe, expect, it } from 'vitest'
import { freeSpace } from './freeSpace'

describe('freeSpace', () => {
  it('keeps a reported free space', () => {
    expect(freeSpace(40e9)).toBe(40e9)
  })

  it.each([0, -1, undefined])('treats %s as unknown', (reported) => {
    expect(freeSpace(reported)).toBeUndefined()
  })
})
