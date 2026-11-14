// What counts as a raw value in the app's stylesheets: one definition for `src/styles/tokens.test.ts`,
// which fails a raw value without a comment on its line, and for the checks guard, which marks for the
// coordinator a raw value a branch adds with such a comment and every design token it adds, changes or
// removes (docs/QUALITY.md → The checks guard). The guard runs main's copy over a branch, so a change
// here changes both at once, and goes to the owner as a change to the guard. Stylesheets are parsed
// with PostCSS, which Vite's own CSS handling brings in; the values inside a declaration are read by
// the patterns below.
import { Input, parse, type AtRule, type Node, type Rule } from 'postcss'
import tokenizer from 'postcss/lib/tokenize'

/** The design tokens, the only stylesheet whose values aren't checked: they are the scale. */
export const TOKENS_FILE = 'src/styles/tokens.css'

/** The app's stylesheets, which the test reads: every `.css` under `src/`. */
export const isStylesheet = (path: string): boolean => path.startsWith('src/') && path.endsWith('.css')

/** A stylesheet by its path from the repository's root, and its text. */
export type Sheet = { file: string; text: string }

/** A declaration of a stylesheet, where it sits and what its value says. */
export interface Declaration {
  file: string
  /** The at-rules and the selector around it, outermost first: `@media (min-width: 1024px) :root`. */
  where: string
  prop: string
  /** The value as written, without `!important`, its comments blanked to spaces, so an index into it is one into the file. */
  value: string
  important: boolean
  /** The value's line in the file for an index into `value`. */
  lineAt: (index: number) => number
  /** Whether the line has a comment. */
  commented: (line: number) => boolean
}

/**
 * Where each comment starts and ends, from PostCSS's own tokenizer, so a `/*` in a string or an
 * unquoted url() opens none, exactly as the parser reads it. Called after the parse, which throws
 * on a comment left open.
 */
function commentSpans(text: string): [number, number][] {
  const tokens = tokenizer(new Input(text))
  const spans: [number, number][] = []
  while (!tokens.endOfFile()) {
    const [type, , start, end] = tokens.nextToken() ?? []
    if (type !== 'comment') continue
    // A comment's token has its first and last offsets; the tokenizer promises nothing, so a
    // PostCSS that stopped giving them fails here rather than reading comments wrong.
    if (start === undefined || end === undefined) throw new Error("PostCSS's tokenizer gave a comment without its offsets")
    spans.push([start, end + 1])
  }
  return spans
}

/** What a node sits in, outermost first. */
function where(node: Node): string {
  const around: string[] = []
  for (let parent = node.parent as Node | undefined; parent; parent = parent.parent as Node | undefined) {
    if (parent.type === 'rule') around.unshift((parent as Rule).selector)
    else if (parent.type === 'atrule') around.unshift(`@${(parent as AtRule).name} ${(parent as AtRule).params}`)
  }
  return around.map((part) => part.replace(/\s+/g, ' ').trim()).join(' ')
}

/**
 * Every declaration of a stylesheet; throws, with PostCSS's reason, on one it can't parse. A byte
 * order mark is left out first, as PostCSS leaves it out of its offsets.
 */
export function declarations({ file, text: raw }: Sheet): Declaration[] {
  const text = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
  const root = parse(text, { from: file })
  const spans = commentSpans(text)
  const newlines = [...text.matchAll(/\n/g)].map((m) => m.index)
  /** The 1-based line of an index: the newlines before it, plus one. */
  const lineOf = (index: number) => {
    let low = 0
    let high = newlines.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (newlines[mid] < index) low = mid + 1
      else high = mid
    }
    return low + 1
  }
  const commentedLines = new Set<number>()
  for (const [start, end] of spans) for (let line = lineOf(start); line <= lineOf(end - 1); line++) commentedLines.add(line)
  // Comments become spaces of the same length, so indexes stay where they were.
  let code = text
  for (const [start, end] of spans) code = code.slice(0, start) + code.slice(start, end).replace(/[^\n]/g, ' ') + code.slice(end)
  const found: Declaration[] = []
  root.walkDecls((decl) => {
    const start = decl.source?.start?.offset ?? 0
    const valueStart = start + decl.prop.length + (decl.raws.between ?? ':').length
    const value = decl.raws.value?.raw ?? decl.value
    found.push({
      file,
      where: where(decl),
      prop: decl.prop,
      value: code.slice(valueStart, valueStart + value.length),
      important: decl.important === true,
      lineAt: (index) => lineOf(valueStart + index),
      commented: (line) => commentedLines.has(line),
    })
  })
  return found
}

/** What kind of value a raw one stands in for, which says which token it should be. */
export type Kind = 'spacing' | 'radius' | 'type' | 'color' | 'shadow' | 'motion'

/**
 * A raw value: where it is, what the test says about it, and whether the test lets it through,
 * which a comment on its line does, unless the tokens have the very value.
 */
export interface RawValue {
  kind: Kind
  file: string
  line: number
  prop: string
  /** The value as written, `12px` or `#abc`. */
  raw: string
  /** What the test says, after the place: `12px is off the scale: add a comment on the line saying why`. */
  says: string
  allowed: boolean
  /**
   * For a shadow in a custom property: the declarations that take it through a var(), each by its
   * file and line, since a new one makes the property cast a shadow where it didn't.
   */
  via: { file: string; line: number }[]
}

// Sizes: a `gap`, `padding`, `margin` or `border-radius` written in px fails when the scale has that
// value, a `font-size` or `line-height` in px fails when a type role has it, and a value the tokens
// don't have needs a comment saying why. Negative values, widths, heights and font weights aren't checked.
const SIZES: { kind: Kind; prop: RegExp; scale: string }[] = [
  { kind: 'spacing', prop: /^(?:gap|row-gap|column-gap|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?)$/, scale: 'the scale' },
  { kind: 'radius', prop: /^(?:-webkit-)?(?:border-radius|border-[a-z-]+-radius)$/, scale: 'the scale' },
  { kind: 'type', prop: /^(?:font-size|line-height|font)$/, scale: 'a type role' },
]
// A positive px length on its own: not part of a number, a negative value or a word.
const PX = /(?<![\d.\-\w])(\d+(?:\.\d+)?)px\b/g

/** The token to write instead of a px value of a property, if the tokens have it. */
export type Token = (prop: string, px: string) => string | undefined

/** `var(--space-2)` by `8px`, from tokens.css itself, so the test follows the scale. */
export function scale(tokens: string, prefix: string): Token {
  const pattern = new RegExp(`--(${prefix}-[a-z0-9]+):\\s*(\\d+px)`, 'g')
  const byPx = new Map([...tokens.matchAll(pattern)].map(([, name, value]) => [value, `var(--${name})`]))
  return (_prop, px) => byPx.get(px)
}

/**
 * `font: var(--t-cap)` by `13px` for a font-size (a role's size) and by `18px` for a line-height
 * (a role's line-height), from the roles in tokens.css. A `font` shorthand is checked against both.
 */
export function roles(tokens: string): Token {
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

// The named and system colors of CSS Color 4 (lowercase, as identifiers are compared).
// `transparent` and `currentColor` aren't raw: they name no color.
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
  whitesmoke yellow yellowgreen
  canvas canvastext linktext visitedtext activetext buttonface buttontext buttonborder field fieldtext
  highlight highlighttext selecteditem selecteditemtext mark marktext graytext accentcolor
  accentcolortext`.split(/\s+/),
)
const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g
// Any call, whatever its arguments: `rgb(calc(var(--n) * 1) 0 0)` is as raw as `rgb(255 0 0)`.
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g
// A whole identifier: `--teal` or `ks-tan` isn't the color `teal` or `tan`.
const IDENT = /(?<![\w-])[a-zA-Z][\w-]*(?![\w-])/g

/**
 * A data: URL, in a url() or as a string, which `image-set()` and `cross-fade()` take: it can draw any
 * color, and its content (%-encoded or base64) can't be read for one, so it needs a comment saying why.
 */
export const DATA_URL = /(?:\burl\(\s*['"]?|['"])\s*data:/gi
const NAMED_PROP = /^(?:-webkit-)?(?:animation|transition|grid)(?:-[a-z-]+)?$/

/** The whole call that starts at an index, up to its closing parenthesis, for the message. */
function call(value: string, start: number): string {
  let depth = 0
  for (let i = value.indexOf('(', start); i < value.length; i++) {
    if (value[i] === '(') depth++
    else if (value[i] === ')' && --depth === 0) return value.slice(start, i + 1)
  }
  return value.slice(start)
}

/** The raw colors in a declaration's value, with their index. */
export function rawColors(prop: string, raw: string): [string, number][] {
  // What a url() names is a file or an element, not a color. A data: URL is a case of its own
  // (DATA_URL), since what it draws can't be read here.
  const value = raw.replace(/\burl\([^)]*\)/gi, (url) => ' '.repeat(url.length))
  const found: [string, number][] = []
  for (const m of value.matchAll(HEX)) found.push([m[0], m.index])
  for (const m of value.matchAll(COLOR_FUNCTION)) found.push([call(value, m.index), m.index])
  // Names in an animation, a transition or a grid area are keyframes, properties and areas
  // (`highlight`, `mark`), never colors.
  if (NAMED_PROP.test(prop)) return found
  for (const m of value.matchAll(IDENT)) if (NAMED_COLORS.has(m[0].toLowerCase())) found.push([m[0], m.index])
  return found
}

// A time other than zero (a negative delay included), and an easing other than `linear` (no easing, as a spinner or a fill
// that shows a clock needs).
const TIME = /(?<![\w.-])-?(\d*\.?\d+)(ms|s)\b/g
const EASING = /(?<![\w-])(?:ease|ease-in|ease-out|ease-in-out|step-start|step-end)(?![\w-])|\b(?:cubic-bezier|steps|linear)\(/g
const MOTION_PROP = /^(?:-webkit-)?(?:transition|animation)(?:-[a-z-]+)?$/
const SHADOW_PROP = /^(?:-webkit-)?(?:box-shadow|text-shadow|filter)$/
const FILTER_PROP = /^(?:-webkit-)?filter$/

/** The raw durations and easings in a value, with their index. */
export function rawMotion(value: string): [string, number][] {
  const found: [string, number][] = []
  for (const m of value.matchAll(TIME)) if (Number(m[1]) !== 0) found.push([m[0], m.index])
  for (const m of value.matchAll(EASING)) found.push([m[0].endsWith('(') ? call(value, m.index) : m[0], m.index])
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

/** A value's parts at its top-level spaces, with each part's index. */
function parts(value: string): [string, number][] {
  const found: [string, number][] = []
  let depth = 0
  let start = -1
  for (let i = 0; i <= value.length; i++) {
    const char = value[i]
    const space = char === undefined || (/\s/.test(char) && depth === 0)
    if (!space && start < 0) start = i
    if (char === '(') depth++
    else if (char === ')') depth--
    if (space && start >= 0) {
      found.push([value.slice(start, i), start])
      start = -1
    }
  }
  return found
}

/**
 * Whether a shadow layer casts a shadow. A ring or a fill drawn with box-shadow (a focus ring, a
 * hover tint) has a literal zero for each of its offsets and its blur, its first three lengths after
 * `inset`; anything else there, a var() or a calc() included, casts one. Its color is the color
 * rule's.
 */
export function castsShadow(layer: string): boolean {
  const geometry = parts(layer).map(([part]) => part).filter((part) => part !== 'inset')
  return geometry.slice(0, 3).some((part) => !/^0(?:\.0*)?(?:px|em|rem)?$/.test(part))
}

// What a layer may be instead of a shadow: no shadow, or a CSS-wide keyword.
const NO_SHADOW = new Set(['none', 'inherit', 'initial', 'unset', 'revert', 'revert-layer'])

interface Shadow {
  d: Declaration
  index: number
  layer: string
  /** The declaration that takes it through a var(), and where in its value. */
  from?: { d: Declaration; index: number }
}

/**
 * The shadow layers of a value that cast a shadow. A layer that is a single var() (after `inset`)
 * is followed into its definitions outside tokens.css (`own`), and its fallback is read as layers of its own.
 */
function shadowsIn(d: Declaration, value: string, offset: number, own: Map<string, Declaration[]>, seen: Set<string>, from?: Shadow['from']): Shadow[] {
  const found: Shadow[] = []
  for (const [raw, rawIndex] of layers(value)) {
    const layer = raw.trim()
    if (NO_SHADOW.has(layer)) continue
    const index = offset + rawIndex + raw.length - raw.trimStart().length
    const rest = parts(layer).filter(([part]) => part !== 'inset')
    const only = rest.length === 1 ? /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/.exec(rest[0][0]) : null
    if (!only) {
      if (castsShadow(layer)) found.push({ d, index, layer, from })
      continue
    }
    const [, name, fallback] = only
    if (fallback !== undefined) {
      const fallbackIndex = index + rest[0][1] + rest[0][0].indexOf(',') + 1
      found.push(...shadowsIn(d, fallback, fallbackIndex, own, seen, from))
    }
    if (seen.has(name)) continue
    seen.add(name)
    for (const definition of own.get(name) ?? []) found.push(...shadowsIn(definition, definition.value, 0, own, seen, from ?? { d, index }))
  }
  return found
}

/** The shadows a declaration casts outside the --shadow tokens. */
function rawShadows(d: Declaration, own: Map<string, Declaration[]>): Shadow[] {
  // A drop-shadow() anywhere in a filter, or in a custom property, which a filter may take.
  if (FILTER_PROP.test(d.prop) || d.prop.startsWith('--')) {
    return [...d.value.matchAll(/\bdrop-shadow\(/g)].map((m) => ({ d, index: m.index, layer: 'drop-shadow()' }))
  }
  return shadowsIn(d, d.value, 0, own, new Set())
}

/**
 * Every raw value in the app's stylesheets, tokens.css aside, whose text gives the scale: those the
 * test fails and those a comment on their line lets through.
 */
export function rawValues(sheets: Sheet[]): RawValue[] {
  const tokens = sheets.find(({ file }) => file === TOKENS_FILE)?.text ?? ''
  const outside = sheets.filter(({ file }) => file !== TOKENS_FILE).flatMap(declarations)
  const found: RawValue[] = []
  /** A raw value at a value's index, which its line's comment lets through unless `fix` names the token it is. */
  const at = (kind: Kind, d: Declaration, index: number, raw: string, says: string, fix = false): RawValue => {
    const line = d.lineAt(index)
    const value: RawValue = { kind, file: d.file, line, prop: d.prop, raw, says, allowed: !fix && d.commented(line), via: [] }
    found.push(value)
    return value
  }

  const tokenOf: Record<'spacing' | 'radius' | 'type', Token> = { spacing: scale(tokens, 'space'), radius: scale(tokens, 'r'), type: roles(tokens) }
  for (const { kind, prop, scale: on } of SIZES) {
    for (const d of outside) {
      if (!prop.test(d.prop)) continue
      for (const m of d.value.matchAll(PX)) {
        if (Number(m[1]) === 0) continue
        const px = `${m[1]}px`
        const token = tokenOf[kind as keyof typeof tokenOf](d.prop, px)
        if (token) at(kind, d, m.index, px, `${px} is on ${on}: use ${token}`, true)
        else at(kind, d, m.index, px, `${px} is off ${on}: add a comment on the line saying why`)
      }
    }
  }

  for (const d of outside) {
    for (const [color, index] of rawColors(d.prop, d.value)) {
      at('color', d, index, color, `${color} is a raw color: use a token from tokens.css, or add a comment on the line saying why`)
    }
    for (const m of d.value.matchAll(DATA_URL)) {
      at('color', d, m.index, 'data:', 'a data: URL may draw raw colors: use a file or a token, or add a comment on the line saying why')
    }
  }

  // Custom properties defined outside tokens.css, by name, which a shadow's var() is followed into.
  const own = new Map<string, Declaration[]>()
  for (const d of outside) if (d.prop.startsWith('--')) own.set(d.prop, [...(own.get(d.prop) ?? []), d])
  // A shadow in a custom property is one value however many declarations take it: reported once,
  // with each of them.
  const shadows = new Map<string, RawValue>()
  for (const d of outside) {
    if (!SHADOW_PROP.test(d.prop) && !d.prop.startsWith('--')) continue
    for (const { d: where, index, layer, from } of rawShadows(d, own)) {
      const key = `${where.file}:${where.lineAt(index)}:${where.prop}:${layer}`
      const shadow = shadows.get(key) ?? at('shadow', where, index, layer, `${layer} is a raw shadow: use a --shadow token, or add a comment on the line saying why`)
      if (from) shadow.via.push({ file: from.d.file, line: from.d.lineAt(from.index) })
      shadows.set(key, shadow)
    }
  }

  for (const d of outside) {
    if (!MOTION_PROP.test(d.prop) && !d.prop.startsWith('--')) continue
    for (const [raw, index] of rawMotion(d.value)) {
      at('motion', d, index, raw, `${raw} is raw motion: use --d-* and --ease*, or add a comment on the line saying why`)
    }
  }
  return found
}

/** A raw value as the test reports it: `src/App.css:12 padding: 12px is off the scale: …`. */
export const problem = ({ file, line, prop, says }: RawValue): string => `${file}:${line} ${prop}: ${says}`

/**
 * The design tokens' declarations, each by where it sits and its name (`:root\t--space-2`), with
 * its value as written, comments and runs of spaces aside, so a reformatted value is the same one,
 * and `!important` kept. A name declared twice in a block (a fallback before what newer browsers
 * read) has both values, in order, joined by `; `.
 */
export function tokensIn(text: string): Map<string, string> {
  const tokens = new Map<string, string>()
  for (const d of declarations({ file: TOKENS_FILE, text })) {
    const key = `${d.where}\t${d.prop}`
    const value = `${d.value.replace(/\s+/g, ' ').trim()}${d.important ? ' !important' : ''}`
    tokens.set(key, tokens.has(key) ? `${tokens.get(key)}; ${value}` : value)
  }
  return tokens
}

/**
 * The at-rules of a stylesheet that hold no declaration, which `tokensIn` can't read as tokens:
 * an `@import` of another stylesheet, a `@layer` order, an empty block. Each as where it sits and
 * the rule itself, in single spaces.
 */
export function atRulesIn(text: string): string[] {
  const found: string[] = []
  // No offsets are read here, so the byte order mark PostCSS strips doesn't matter.
  parse(text).walkAtRules((rule) => {
    let holds = false
    rule.walkDecls(() => {
      holds = true
    })
    if (!holds) found.push(`${where(rule)} @${rule.name} ${rule.params}`.replace(/\s+/g, ' ').trim())
  })
  return found
}
