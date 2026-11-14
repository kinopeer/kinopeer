import { describe, expect, it, vi } from 'vitest'
import { declarations } from './stylesheets.ts'

// PostCSS's tokenizer has no types and no promise about its tokens, so a comment token without its
// offsets, which today's PostCSS never gives, is faked here: reading comments fails rather than
// putting them in the wrong place.
const token = vi.hoisted(() => ({ value: ['comment', '/* x */'] as unknown[] }))
vi.mock('postcss/lib/tokenize', () => ({
  default: () => {
    let given = false
    return {
      endOfFile: () => given,
      nextToken: () => {
        given = true
        return token.value
      },
    }
  },
}))

describe('declarations over a tokenizer that changed', () => {
  it('fails on a comment token without either offset, and reads one with both', () => {
    const read = () => declarations({ file: 'src/a.css', text: 'a { /* x */ padding: 13px; }' })
    for (const value of [['comment', '/* x */'], ['comment', '/* x */', 4], ['comment', '/* x */', undefined, 10]]) {
      token.value = value
      expect(read).toThrow("PostCSS's tokenizer gave a comment without its offsets")
    }
    token.value = ['comment', '/* x */', 4, 10]
    expect(read()[0].commented(1)).toBe(true)
    token.value = ['space', ' ']
    expect(read()[0].commented(1)).toBe(false)
  })
})
