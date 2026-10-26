import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Spacing and radii go through the tokens in tokens.css (CLAUDE.md → Design). This test keeps new
 * code on them: a `gap`, `padding`, `margin` or `border-radius` written in px fails when the scale
 * has that value, and a value the scale doesn't have fails unless the line carries a comment saying
 * why, or the file already had it before the rule (the lists below, which only shrink: an entry no
 * longer used fails too). Negative values, widths, heights and font sizes aren't checked.
 */

// Vitest runs from the project root (import.meta.url isn't a file URL under jsdom).
const SRC = join(process.cwd(), 'src')

// Stylesheets that still have to be moved onto the tokens.
const SKIPPED: string[] = []

// Off-scale values the stylesheets had when the rule arrived, per file. Remove an entry when the
// value goes; add nothing here, write a comment on the line instead.
const LEGACY_SPACING: Record<string, string[]> = {
  'src/components/Badge/Badge.css': ['7px'],
  'src/components/Banner/Banner.css': ['10px', '14px'],
  'src/components/Button/Button.css': ['6px', '14px'],
  'src/components/Dialog/Dialog.css': ['10px', '14px', '18px'],
  'src/components/EmptyState/EmptyState.css': ['6px', '10px', '28px'],
  'src/components/FilterChip/FilterChip.css': ['6px', '14px'],
  'src/components/Input/Input.css': ['6px', '14px', '44px'],
  'src/components/Menu/Menu.css': ['2px', '6px', '10px'],
  'src/components/Poster/Poster.css': ['5px'],
  'src/components/PosterCard/PosterCard.css': ['2px', '4.5px', '18px'],
  'src/components/Segmented/Segmented.css': ['2px', '3px', '6px'],
  'src/components/Sheet/Sheet.css': ['2px', '6px', '18px'],
  'src/components/Sidebar/Sidebar.css': ['1px', '2px', '5px', '6px', '10px', '14px', '22px'],
  'src/components/StatusChip/StatusChip.css': ['6px', '9px'],
  'src/components/TabBar/TabBar.css': ['3px', '6px'],
  'src/components/Toast/Toast.css': ['6px'],
  'src/screens/AddReleaseSheet.css': ['2px', '5px', '6px', '7px', '10px', '14px'],
  'src/screens/ChangeTitleSheet.css': ['2px', '6px'],
  'src/screens/DeleteTorrentDialog.css': ['2px', '6px'],
  'src/screens/DownloadsScreen.css': ['1px', '2px', '5px', '6px', '10px', '14px', '18px', '28px', '38px', '112px'],
  'src/screens/Install.css': ['6px', '10px', '14px'],
  'src/screens/MatchPrompt.css': ['1px', '10px', '14px'],
  'src/screens/ReleasesScreen.css': ['2px', '5px', '6px', '10px', '14px'],
  'src/screens/SearchScreen.css': ['10px', '14px', '18px', '28px'],
  'src/screens/SettingsScreen.css': ['6px', '10px', '14px', '18px', '26px', '28px', '56px'],
  'src/screens/TitleReleases.css': ['10px', '14px'],
  'src/screens/TitleScreen.css': ['2px', '5px', '6px', '10px', '14px', '18px', '28px', '72px', '88px'],
  'src/screens/TorrentScreen.css': ['6px', '10px', '11px', '14px', '72px'],
}

const LEGACY_RADIUS: Record<string, string[]> = {
  'src/components/Button/Button.css': ['16px'],
  'src/components/Checkbox/Checkbox.css': ['7px', '12px'],
  'src/components/Dialog/Dialog.css': ['16px', '24px'],
  'src/components/EmptyState/EmptyState.css': ['24px'],
  'src/components/IconButton/IconButton.css': ['12px'],
  'src/components/Input/Input.css': ['12px'],
  'src/components/Popover/Popover.css': ['16px'],
  'src/components/Poster/Poster.css': ['12px'],
  'src/components/PosterCard/PosterCard.css': ['12px'],
  'src/components/ProgressBar/ProgressBar.css': ['2px', '4px'],
  'src/components/Segmented/Segmented.css': ['13px'],
  'src/components/Sheet/Sheet.css': ['3px', '24px'],
  'src/components/Sidebar/Sidebar.css': ['12px', '16px'],
  'src/components/StatusChip/StatusChip.css': ['1px'],
  'src/components/TabBar/TabBar.css': ['12px'],
  'src/components/Toast/Toast.css': ['16px'],
  'src/screens/DownloadsScreen.css': ['7px', '8px', '12px', '18px'],
  'src/screens/AddReleaseSheet.css': ['9px', '16px'],
  'src/screens/ChangeTitleSheet.css': ['8px', '12px'],
  'src/screens/Install.css': ['12px'],
  'src/screens/ReleasesScreen.css': ['18px'],
  'src/screens/SearchScreen.css': ['2px', '4px'],
  'src/screens/SettingsScreen.css': ['12px'],
  'src/screens/TitleScreen.css': ['16px', '18px'],
  'src/screens/TorrentScreen.css': ['12px'],
  'src/styles/base.css': ['8px'],
}

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
  legacy: Record<string, string[]>
}

function check(kind: Kind): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const path of cssFiles(SRC)) {
    const file = `src/${relative(SRC, path)}`
    if (file === 'src/styles/tokens.css' || SKIPPED.includes(file)) continue
    const lines = readFileSync(path, 'utf8').split('\n')
    lines.forEach((line, i) => {
      for (const [, prop, value] of line.matchAll(kind.prop)) for (const [, number] of value.matchAll(PX)) {
        if (Number(number) === 0) continue
        const px = `${number}px`
        const token = kind.tokens.get(px)
        const where = `${file}:${i + 1} ${prop}: ${px}`
        if (token) {
          problems.push(`${where} is on the scale: use ${token}`)
        } else if (kind.legacy[file]?.includes(px)) {
          seen.add(`${file} ${px}`)
        } else if (!COMMENT.test(line)) {
          problems.push(`${where} is off the scale: add a comment on the line saying why`)
        }
      }
    })
  }
  for (const [file, values] of Object.entries(kind.legacy)) {
    for (const px of values) {
      if (!seen.has(`${file} ${px}`)) problems.push(`${file} no longer has ${px}: remove it from the legacy list`)
    }
  }
  return problems
}

describe('stylesheets', () => {
  it('write spacing through the --space tokens', () => {
    expect(check({ prop: SPACING_PROP, tokens: scale('space'), legacy: LEGACY_SPACING })).toEqual([])
  })

  it('write radii through the --r tokens', () => {
    expect(check({ prop: RADIUS_PROP, tokens: scale('r'), legacy: LEGACY_RADIUS })).toEqual([])
  })
})
