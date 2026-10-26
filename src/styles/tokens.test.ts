import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Spacing, radii and type go through the tokens in tokens.css (CLAUDE.md → Design). This test keeps
 * the code on them: a `gap`, `padding`, `margin` or `border-radius` written in px fails when the
 * scale has that value, a `font-size` or `line-height` in px fails when a type role has it, and a
 * value the tokens don't have fails unless the line carries a comment saying why. Negative values,
 * widths, heights and font weights aren't checked.
 */

// Vitest runs from the project root (import.meta.url isn't a file URL under jsdom).
const SRC = join(process.cwd(), 'src')

// A declaration of the property, at the start of the line or after another one on the same line.
const SPACING_PROP = /(?:^|[;{])\s*(gap|row-gap|column-gap|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?)\s*:\s*([^;}]*)/g
const RADIUS_PROP = /(?:^|[;{])\s*(border-radius|border-[a-z-]+-radius)\s*:\s*([^;}]*)/g
const TYPE_PROP = /(?:^|[;{])\s*(font-size|line-height|font)\s*:\s*([^;}]*)/g
// A positive px length on its own: not part of a number, a negative value or a word.
const PX = /(?<![\d.\-\w])(\d+(?:\.\d+)?)px\b/g
const COMMENT = /\/\*.*\*\//

/** `var(--space-2)` by `8px`, from tokens.css itself, so the test follows the scale. */
function scale(prefix: string): Token {
  const tokens = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8')
  const pattern = new RegExp(`--(${prefix}-[a-z0-9]+):\\s*(\\d+px)`, 'g')
  const byPx = new Map([...tokens.matchAll(pattern)].map(([, name, value]) => [value, `var(--${name})`]))
  return (_prop, px) => byPx.get(px)
}

/**
 * `font: var(--t-cap)` by `13px` for a font-size (a role's size) and by `18px` for a line-height
 * (a role's line-height), from the roles in tokens.css. A `font` shorthand is checked against both.
 */
function roles(): Token {
  const tokens = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8')
  const pattern = /--(t-[a-z0-9-]+):\s*\d+\s+(\d+(?:\.\d+)?px)\/(\d+px)/g
  const sizes = new Map<string, string>()
  const lineHeights = new Map<string, string>()
  for (const [, name, size, lineHeight] of tokens.matchAll(pattern)) {
    const token = `font: var(--${name})`
    if (!sizes.has(size)) sizes.set(size, token)
    if (!lineHeights.has(lineHeight)) lineHeights.set(lineHeight, token)
  }
  return (prop, px) => (prop === 'line-height' ? lineHeights.get(px) : sizes.get(px) ?? lineHeights.get(px))
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

/** The token to write instead of a px value of a property, if the tokens have it. */
type Token = (prop: string, px: string) => string | undefined

interface Kind {
  prop: RegExp
  token: Token
  /** What a value the tokens have is on: "the scale" or "a type role". */
  scale: string
}

function check(kind: Kind): string[] {
  const problems: string[] = []
  for (const path of cssFiles(SRC)) {
    const file = `src/${relative(SRC, path)}`
    if (file === 'src/styles/tokens.css') continue
    const lines = readFileSync(path, 'utf8').split('\n')
    lines.forEach((line, i) => {
      for (const [, prop, value] of line.matchAll(kind.prop)) for (const [, number] of value.matchAll(PX)) {
        if (Number(number) === 0) continue
        const px = `${number}px`
        const token = kind.token(prop, px)
        const where = `${file}:${i + 1} ${prop}: ${px}`
        if (token) {
          problems.push(`${where} is on ${kind.scale}: use ${token}`)
        } else if (!COMMENT.test(line)) {
          problems.push(`${where} is off ${kind.scale}: add a comment on the line saying why`)
        }
      }
    })
  }
  return problems
}

describe('stylesheets', () => {
  it('write spacing through the --space tokens', () => {
    expect(check({ prop: SPACING_PROP, token: scale('space'), scale: 'the scale' })).toEqual([])
  })

  it('write radii through the --r tokens', () => {
    expect(check({ prop: RADIUS_PROP, token: scale('r'), scale: 'the scale' })).toEqual([])
  })

  it('write font sizes through the type roles', () => {
    const token = roles()
    expect(token('font-size', '13px')).toBe('font: var(--t-cap)')
    expect(token('line-height', '18px')).toBe('font: var(--t-cap)')
    expect(token('font-size', '12px')).toBeUndefined()
    expect(check({ prop: TYPE_PROP, token, scale: 'a type role' })).toEqual([])
  })
})
