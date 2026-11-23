import { describe, expect, it } from 'vitest'
import { isDeepLink } from './deepLink'

describe('isDeepLink', () => {
  it('reads the document’s first entry as opened from a link', () => {
    expect(isDeepLink({ key: 'default', state: null })).toBe(true)
  })

  it('reads an entry that replaced it and said so as opened from a link', () => {
    expect(isDeepLink({ key: 'a1b2c3', state: { deepLink: true } })).toBe(true)
  })

  it('reads any other entry as opened from inside the app', () => {
    expect(isDeepLink({ key: 'a1b2c3', state: null })).toBe(false)
    expect(isDeepLink({ key: 'a1b2c3', state: { deepLink: false } })).toBe(false)
    expect(isDeepLink({ key: 'a1b2c3', state: { background: {} } })).toBe(false)
  })
})
