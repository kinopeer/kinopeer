import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Spacing and radii go through the tokens in tokens.css (CLAUDE.md → Design). This test keeps the
 * code on them: a `gap`, `padding`, `margin` or `border-radius` written in px fails when the scale
 * has that value, and a value the scale doesn't have fails unless the line carries a comment saying
 * why. Negative values, widths, heights and font sizes aren't checked.
 */

// Vitest runs from the project root (import.meta.url isn't a file URL under jsdom).
const SRC = join(process.cwd(), 'src')

// A declaration of the property, at the start of the line or after another one on the same line.
const SPACING_PROP = /(?:^|[;{])\s*(gap|row-gap|column-gap|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?)\s*:\s*([^;}]*)/g
const RADIUS_PROP = /(?:^|[;{])\s*(border-radius|border-[a-z-]+-radius)\s*:\s*([^;}]*)/g
// A positive px length on its own: not part of a number, a negative value or a word.
const PX = /(?<![\d.\-\w])(\d+(?:\.\d+)?)px\b/g
const COMMENT = /\/\*.*\*\//

/** `var(--space-2)` by `8px`, from tokens.css itself, so the test follows the scale. */
function scale(prefix: string): Map<string, string> {
  const tokens = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8')
  const pattern = new RegExp(`--(${prefix}-[a-z0-9]+):\\s*(\\d+px)`, 'g')
  return new Map([...tokens.matchAll(pattern)].map(([, name, value]) => [value, `var(--${name})`]))
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

interface Kind {
  prop: RegExp
  tokens: Map<string, string>
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
        const token = kind.tokens.get(px)
        const where = `${file}:${i + 1} ${prop}: ${px}`
        if (token) {
          problems.push(`${where} is on the scale: use ${token}`)
        } else if (!COMMENT.test(line)) {
          problems.push(`${where} is off the scale: add a comment on the line saying why`)
        }
      }
    })
  }
  return problems
}

describe('stylesheets', () => {
  it('write spacing through the --space tokens', () => {
    expect(check({ prop: SPACING_PROP, tokens: scale('space') })).toEqual([])
  })

  it('write radii through the --r tokens', () => {
    expect(check({ prop: RADIUS_PROP, tokens: scale('r') })).toEqual([])
  })
})
