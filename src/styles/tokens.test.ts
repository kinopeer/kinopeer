import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Spacing, radii and type go through the tokens in tokens.css (CLAUDE.md → Design). This test keeps
 * the code on them: a `gap`, `padding`, `margin` or `border-radius` written in px fails when the
 * scale has that value, a `font-size` or `line-height` in px fails when a type role has it, and a
 * value the tokens don't have fails unless the line carries a comment saying why. Negative values,
 * widths, heights and font weights aren't checked. Colors, shadows and motion: below.
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

/**
 * Colors, shadows and motion go through the tokens too. These read each stylesheet as declarations,
 * across lines, with comments blanked out (a comment still marks its lines). A value the tokens
 * can't express is allowed with a comment on its line saying why, as above.
 */

/** A declaration of a stylesheet: what's after `{` or `;` up to the next `;` or `}`. */
interface Declaration {
  file: string
  prop: string
  value: string
  /** The value's line in the file for an index into `value`. */
  lineAt: (index: number) => number
  /** Whether the line has a comment. */
  commented: (line: number) => boolean
}

const TOKENS_FILE = 'src/styles/tokens.css'

function declarations(path: string): Declaration[] {
  const file = `src/${relative(SRC, path)}`
  const text = readFileSync(path, 'utf8')
  const commentedLines = new Set<number>()
  const lineOf = (index: number) => text.slice(0, index).split('\n').length
  // Comments become spaces of the same length, so indexes and lines stay where they were.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (comment, start: number) => {
    const first = lineOf(start)
    for (let line = first; line <= first + comment.split('\n').length - 1; line++) commentedLines.add(line)
    return comment.replace(/[^\n]/g, ' ')
  })
  return [...code.matchAll(/[{;]\s*(-?-?[a-zA-Z][\w-]*)\s*:([^;{}]*)(?=[;}])/g)].map((match) => {
    const valueStart = match.index + match[0].length - match[2].length
    return {
      file,
      prop: match[1],
      value: match[2],
      lineAt: (index) => lineOf(valueStart + index),
      commented: (line) => commentedLines.has(line),
    }
  })
}

const ALL = cssFiles(SRC).flatMap(declarations)
const OUTSIDE_TOKENS = ALL.filter((d) => d.file !== TOKENS_FILE)

// The named colors of CSS Color 4. `transparent` and `currentColor` aren't raw: they name no color.
const NAMED_COLORS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
  brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue
  darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange
  darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise
  darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia
  gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo
  ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue
  lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon
  mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
  mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
  navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
  paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
  rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue
  slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
  whitesmoke yellow yellowgreen`.split(/\s+/),
)
const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/g
// A whole identifier: `--teal` or `ks-tan` isn't the color `teal` or `tan`.
const IDENT = /(?<![\w-])[a-zA-Z][\w-]*(?![\w-])/g

/** The raw colors in a value, with their index. */
function rawColors(value: string): [string, number][] {
  const found: [string, number][] = []
  for (const m of value.matchAll(HEX)) found.push([m[0], m.index])
  for (const m of value.matchAll(COLOR_FUNCTION)) found.push([m[0], m.index])
  for (const m of value.matchAll(IDENT)) if (NAMED_COLORS.has(m[0].toLowerCase())) found.push([m[0], m.index])
  return found
}

// A time other than zero, and an easing other than `linear` (no easing, as a spinner or a fill
// that shows a clock needs).
const TIME = /(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g
const EASING = /(?<![\w-])(?:ease|ease-in|ease-out|ease-in-out|step-start|step-end)(?![\w-])|\b(?:cubic-bezier|steps|linear)\([^()]*\)/g
const MOTION_PROP = /^(?:transition|animation)(?:-[a-z-]+)?$/

function rawMotion(value: string): [string, number][] {
  const found: [string, number][] = []
  for (const m of value.matchAll(TIME)) if (Number(m[1]) !== 0) found.push([m[0], m.index])
  for (const m of value.matchAll(EASING)) found.push([m[0], m.index])
  return found
}

/** Splits a value at its top-level commas, with each part's index. */
function layers(value: string): [string, number][] {
  const parts: [string, number][] = []
  let depth = 0
  let start = 0
  for (let i = 0; i <= value.length; i++) {
    const char = value[i]
    if (char === '(') depth++
    else if (char === ')') depth--
    else if ((char === ',' && depth === 0) || i === value.length) {
      parts.push([value.slice(start, i), start])
      start = i + 1
    }
  }
  return parts
}

const LENGTH = /(?<![\w.-])-?(\d*\.?\d+)(?:px|em|rem)?(?![\w.%(-])/g

/**
 * Whether a shadow layer casts a shadow: an offset or a blur. A layer with neither is a ring or a
 * fill drawn with box-shadow (a focus ring, a hover tint), whose color the color rule checks.
 */
function castsShadow(layer: string): boolean {
  // Lengths outside functions: what's inside var() or color-mix() isn't the shadow's geometry.
  const outside = layer.replace(/\b[\w-]+\([^()]*(?:\([^()]*\)[^()]*)*\)/g, (fn) => ' '.repeat(fn.length))
  const lengths = [...outside.matchAll(LENGTH)].map((m) => Number(m[1]))
  return lengths.slice(0, 3).some((n) => n !== 0)
}

/** Custom properties defined outside tokens.css, by name. */
const OWN_PROPERTIES = new Map<string, Declaration[]>()
for (const d of OUTSIDE_TOKENS) {
  if (d.prop.startsWith('--')) OWN_PROPERTIES.set(d.prop, [...(OWN_PROPERTIES.get(d.prop) ?? []), d])
}

/** The shadow layers of a declaration that cast a shadow, through a var() defined outside tokens.css. */
function rawShadows(d: Declaration, seen = new Set<string>()): { d: Declaration; index: number; layer: string }[] {
  const found: { d: Declaration; index: number; layer: string }[] = []
  if (d.prop === 'filter' || d.prop === '-webkit-filter') {
    for (const m of d.value.matchAll(/\bdrop-shadow\(/g)) found.push({ d, index: m.index, layer: 'drop-shadow()' })
    return found
  }
  for (const [layer, index] of layers(d.value)) {
    const only = /^\s*var\((--[\w-]+)\)\s*$/.exec(layer)
    if (only) {
      if (seen.has(only[1])) continue
      seen.add(only[1])
      for (const own of OWN_PROPERTIES.get(only[1]) ?? []) found.push(...rawShadows(own, seen))
    } else if (castsShadow(layer)) {
      found.push({ d, index, layer: layer.trim() })
    }
  }
  return found
}

/** A problem at a value's index, unless its line carries a comment. */
function at(d: Declaration, index: number, what: string, problems: string[]) {
  const line = d.lineAt(index)
  if (!d.commented(line)) problems.push(`${d.file}:${line} ${d.prop}: ${what}`)
}

describe('stylesheets beyond sizes', () => {
  it('write colors through the color tokens', () => {
    const problems: string[] = []
    for (const d of OUTSIDE_TOKENS) for (const [color, index] of rawColors(d.value)) {
      at(d, index, `${color} is a raw color: use a token from tokens.css, or add a comment on the line saying why`, problems)
    }
    expect(problems).toEqual([])
  })

  it('write shadows through the --shadow tokens', () => {
    const problems: string[] = []
    for (const d of OUTSIDE_TOKENS) {
      if (!/^(?:box-shadow|text-shadow|filter|-webkit-filter)$/.test(d.prop)) continue
      for (const shadow of rawShadows(d)) {
        at(shadow.d, shadow.index, `${shadow.layer} is a raw shadow: use a --shadow token, or add a comment on the line saying why`, problems)
      }
    }
    expect(problems).toEqual([])
  })

  it('write durations and easings through the motion tokens', () => {
    const problems: string[] = []
    for (const d of OUTSIDE_TOKENS) {
      if (!MOTION_PROP.test(d.prop) && !d.prop.startsWith('--')) continue
      for (const [raw, index] of rawMotion(d.value)) {
        at(d, index, `${raw} is raw motion: use --d-* and --ease*, or add a comment on the line saying why`, problems)
      }
    }
    expect(problems).toEqual([])
  })

  it('use only custom properties something defines', () => {
    // Defined by a stylesheet, or set at runtime by the app's code, which names it in a string
    // ('--keyboard-inset' in setProperty, a style object's key, useHeightVar's argument).
    const defined = new Set(ALL.filter((d) => d.prop.startsWith('--')).map((d) => d.prop))
    for (const path of codeFiles(SRC)) {
      for (const [, name] of readFileSync(path, 'utf8').matchAll(/['"](--[\w-]+)['"]/g)) defined.add(name)
    }
    const problems: string[] = []
    for (const d of ALL) for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!defined.has(m[1])) problems.push(`${d.file}:${d.lineAt(m.index)} ${d.prop}: nothing defines ${m[1]}`)
    }
    expect(problems).toEqual([])
  })
})

function codeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return codeFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}
