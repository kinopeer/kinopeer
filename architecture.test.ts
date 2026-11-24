// The architecture is a file per area in .claude/rules/architecture/, which Claude Code loads into a
// session when it reads or edits a file the area's `paths` match (docs/ARCHITECTURE.md). A glob that
// matches nothing, or a file no area matches, loads no rule and nothing says so, so it's checked here:
// every alternative of every glob matches a file of the repository, every code file under `src/` and
// `server/` is in some area, and the map's table names each area's file.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, matchesGlob } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const ROOT = dirname(fileURLToPath(import.meta.url))
const RULES = '.claude/rules/architecture'

/** The repository's files: those git tracks and the new ones it doesn't ignore, still on disk. */
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((path) => path !== '' && existsSync(join(ROOT, path)))

/** Each area's file and its `paths`, read from its front matter as YAML. */
const areas = readdirSync(join(ROOT, RULES))
  .filter((name) => name.endsWith('.md'))
  .map((name) => {
    const text = readFileSync(join(ROOT, RULES, name), 'utf8')
    const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''
    const { paths } = (parse(frontMatter) ?? {}) as { paths?: unknown }
    return { name, paths: Array.isArray(paths) ? paths.map(String) : [] }
  })

/** A glob's alternatives, one per choice of each `{a,b}` (they don't nest in these files). */
const alternatives = (glob: string): string[] => {
  const braces = /\{([^{}]*)\}/.exec(glob)
  if (braces === null) return [glob]
  return braces[1]
    .split(',')
    .flatMap((choice) => alternatives(glob.slice(0, braces.index) + choice + glob.slice(braces.index + braces[0].length)))
}

/** Code no area describes: the tests' shared helpers, and the styles, which CLAUDE.md → Design covers. */
const OUTSIDE_AREAS = ['src/test/**', 'src/test-setup.ts', 'src/styles/**']

describe('the architecture rules', () => {
  it('has areas, each with paths', () => {
    expect(areas.length).toBeGreaterThan(0)
    expect(areas.filter((area) => area.paths.length === 0).map((area) => area.name)).toEqual([])
  })

  it('matches a file with every alternative of every glob', () => {
    const dead = areas.flatMap((area) =>
      area.paths.flatMap(alternatives).filter((glob) => !files.some((path) => matchesGlob(path, glob))).map((glob) => `${area.name}: ${glob}`),
    )
    expect(dead).toEqual([])
  })

  it('puts every code file under src/ and server/ in an area', () => {
    const globs = areas.flatMap((area) => area.paths)
    const outside = files.filter(
      (path) =>
        /^(src|server)\/.*\.tsx?$/.test(path) &&
        !OUTSIDE_AREAS.some((glob) => matchesGlob(path, glob)) &&
        !globs.some((glob) => matchesGlob(path, glob)),
    )
    expect(outside).toEqual([])
  })

  it("names every area's file in the map, and no other", () => {
    const map = readFileSync(join(ROOT, 'docs/ARCHITECTURE.md'), 'utf8')
    const named = [...map.matchAll(/^\| \[`([a-z-]+\.md)`\]/gm)].map((match) => match[1]).sort()
    expect(named).toEqual(areas.map((area) => area.name).sort())
  })
})
