import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { castsShadow, DATA_URL, declarations, problem, rawColors, rawMotion, rawValues, roles, TOKENS_FILE, type Kind, type Sheet } from '../../scripts/guard/stylesheets.ts'

/**
 * Spacing, radii, type, colors, shadows and motion go through the tokens in tokens.css (CLAUDE.md →
 * Design). This test keeps the stylesheets on them: a value the tokens have fails, and a value they
 * don't have fails unless its line carries a comment saying why. What counts as a raw value is
 * defined once, in scripts/guard/stylesheets.ts, which the checks guard reads too: it marks for the
 * coordinator a raw value a branch lets through by its comment, and every token a branch adds,
 * changes or removes (docs/QUALITY.md → The checks guard).
 */

// Vitest runs from the project root (import.meta.url isn't a file URL under jsdom).
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

const SHEETS: Sheet[] = cssFiles(SRC).map((path) => ({ file: relative(ROOT, path), text: readFileSync(path, 'utf8') }))
const RAW = rawValues(SHEETS)
const TOKENS = SHEETS.find(({ file }) => file === TOKENS_FILE)?.text ?? ''

/** What the test fails of one kind of value. */
const problems = (kind: Kind) => RAW.filter((raw) => raw.kind === kind && !raw.allowed).map(problem)

describe('stylesheets', () => {
  it('write spacing through the --space tokens', () => {
    expect(problems('spacing')).toEqual([])
  })

  it('write radii through the --r tokens', () => {
    expect(problems('radius')).toEqual([])
  })

  it('write font sizes through the type roles', () => {
    const token = roles(TOKENS)
    expect(token('font-size', '13px')).toBe('font: var(--t-cap)')
    expect(token('line-height', '18px')).toBe('font: var(--t-cap)')
    expect(token('font-size', '12px')).toBeUndefined()
    expect(problems('type')).toEqual([])
  })
})

/**
 * Colors, shadows and motion go through the tokens too, read in each stylesheet's declarations,
 * across lines. A value the tokens can't express is allowed with a comment on its line saying why,
 * as above.
 */

describe('stylesheets beyond sizes', () => {
  it('write colors through the color tokens', () => {
    const colors = (prop: string, value: string) => rawColors(prop, value).map(([color]) => color)
    expect(colors('color', '#abc rgb(calc(var(--n) * 1) 0 0) White')).toEqual(['#abc', 'rgb(calc(var(--n) * 1) 0 0)', 'White'])
    expect(colors('color', 'color-mix(in srgb, var(--text) 6%, transparent) currentColor')).toEqual([])
    expect(colors('background', 'url(red.svg) url(#red) red')).toEqual(['red'])
    expect(colors('grid-area', 'highlight')).toEqual([])
    // A data: URL can draw any color, and its content (cut at a `;`, %-encoded or base64) can't be
    // read for one, so it needs a comment saying why: in a url(), and as a string, which image-set() takes.
    const dataUrls = (value: string) => [...value.matchAll(DATA_URL)].map(([match]) => match.trim())
    expect(dataUrls('url( "data:x") URL(data:y) url(data.svg) url(icons/data:x.svg)')).toEqual(['url( "data:', 'URL(data:'])
    expect(dataUrls(`image-set("data:image/png;base64,AAAA" 1x, 'data:x' 2x, "a.png" 1x)`)).toEqual(['"data:', "'data:"])
    expect(problems('color')).toEqual([])
  })

  it('write shadows through the --shadow tokens', () => {
    expect(castsShadow('inset 0 0 0 100px var(--hover)')).toBe(false)
    expect(castsShadow('0 0 0 var(--space-1) var(--accent)')).toBe(false)
    expect(castsShadow('0 var(--space-2) var(--space-4) var(--scrim)')).toBe(true)
    expect(castsShadow('0 0 2vw var(--scrim)')).toBe(true)
    expect(problems('shadow')).toEqual([])
  })

  it('write durations and easings through the motion tokens', () => {
    const motion = (value: string) => rawMotion(value).map(([raw]) => raw)
    expect(motion('opacity 0s linear -0.5s ease-out steps(var(--n))')).toEqual(['-0.5s', 'ease-out', 'steps(var(--n))'])
    expect(motion('ks-1s var(--d-fast) var(--ease) linear')).toEqual([])
    expect(problems('motion')).toEqual([])
  })

  it('use only custom properties something defines', () => {
    const all = SHEETS.flatMap(declarations)
    // Defined by a stylesheet, or set at runtime by the app's code, which names it in a string
    // ('--keyboard-inset' in setProperty, a style object's key, useHeightVar's argument).
    const defined = new Set(all.filter((d) => d.prop.startsWith('--')).map((d) => d.prop))
    for (const path of codeFiles(SRC)) {
      for (const [, name] of readFileSync(path, 'utf8').matchAll(/['"](--[\w-]+)['"]/g)) defined.add(name)
    }
    const undefinedOnes: string[] = []
    for (const d of all) for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!defined.has(m[1])) undefinedOnes.push(`${d.file}:${d.lineAt(m.index)} ${d.prop}: nothing defines ${m[1]}`)
    }
    expect(undefinedOnes).toEqual([])
  })
})

function codeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    // The tests' own helpers (src/test/) set properties for a test, not for the app.
    if (entry.isDirectory()) return path === join(SRC, 'test') ? [] : codeFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}
