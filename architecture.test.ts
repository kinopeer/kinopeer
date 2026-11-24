// The rules in .claude/rules/ (the architecture, a file per area in its folder, and the others) are
// loaded by Claude Code into a session when it reads or edits a file their `paths` match
// (docs/ARCHITECTURE.md). A glob that matches nothing, or a file no area matches, loads no rule and
// nothing says so, so it's checked here: every alternative of every rule's glob matches a file of the
// repository, every code file under `src/` and `server/` is in some area of the architecture, and
// the map's table names each area's file.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, matchesGlob } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const ROOT = dirname(fileURLToPath(import.meta.url))
const RULES = '.claude/rules'

/** The repository's files: those git tracks and the new ones it doesn't ignore, still on disk. */
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((path) => path !== '' && existsSync(join(ROOT, path)))

/** Each rule's file, by its path, and its `paths`, read from its front matter as YAML. */
const rules = files
  .filter((path) => path.startsWith(`${RULES}/`) && path.endsWith('.md'))
  .map((path) => {
    const text = readFileSync(join(ROOT, path), 'utf8')
    const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''
    const { paths } = (parse(frontMatter) ?? {}) as { paths?: unknown }
    return { name: path.slice(`${RULES}/`.length), paths: Array.isArray(paths) ? paths.map(String) : [] }
  })

/** The architecture's areas, by their file's name. */
const areas = rules
  .filter((rule) => rule.name.startsWith('architecture/'))
  .map((rule) => ({ ...rule, name: rule.name.slice('architecture/'.length) }))

/** A glob's alternatives, one per choice of each `{a,b}` (they don't nest in these files). */
const alternatives = (glob: string): string[] => {
  const braces = /\{([^{}]*)\}/.exec(glob)
  if (braces === null) return [glob]
  return braces[1]
    .split(',')
    .flatMap((choice) => alternatives(glob.slice(0, braces.index) + choice + glob.slice(braces.index + braces[0].length)))
}

/** Code no area describes: the tests' shared helpers, and the styles, which .claude/rules/design.md covers. */
const OUTSIDE_AREAS = ['src/test/**', 'src/test-setup.ts', 'src/styles/**']

describe('the rules', () => {
  it('has areas, and every rule has paths', () => {
    expect(areas.length).toBeGreaterThan(0)
    expect(rules.filter((rule) => rule.paths.length === 0).map((rule) => rule.name)).toEqual([])
  })

  it('matches a file with every alternative of every glob', () => {
    const dead = rules.flatMap((rule) =>
      rule.paths.flatMap(alternatives).filter((glob) => !files.some((path) => matchesGlob(path, glob))).map((glob) => `${rule.name}: ${glob}`),
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
