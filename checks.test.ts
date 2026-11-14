// checks.json holds the folders scripts/mutants.mjs mutates; two places have to name them again, since
// neither can read checks.json: the paths that start the Mutants workflow and the type check's
// tsconfigs. A folder added to checks.json and missed in one of them (#379, #388) left its changes
// unmutated or unchecked. Each place is read with its own format's parser: the workflow with a YAML
// parser and the tsconfigs by TypeScript itself (`tsc --showConfig`, which lists the files a config
// takes), never with regular expressions (docs/TESTING.md → Choosing a layer's edges). The files
// compared are the repository's, as git lists them, so a git-ignored file a tool writes into a
// folder (wrangler's `.wrangler/`) is left alone: no PR can change it.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, matchesGlob, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const ROOT = dirname(fileURLToPath(import.meta.url))
const TSC = join(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin', 'tsc')

const checks = JSON.parse(readFileSync(join(ROOT, 'checks.json'), 'utf8')) as { mutants: { folders: string[] } }

/** The repository's files under a folder, relative to `root`: those git tracks and the new ones it doesn't ignore, still on disk. */
const filesIn = (root: string, folder: string): string[] =>
  execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', folder], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '' && existsSync(join(root, path)))

const isTypeScript = (path: string): boolean => /\.(m|c)?tsx?$/.test(path)

/** The `paths` filter of a workflow's `pull_request` trigger, as GitHub reads it; empty when it has none. */
const pullRequestPaths = (workflow: string): string[] => {
  const on = (parse(workflow) as { on?: unknown } | null)?.on
  const trigger = on !== null && typeof on === 'object' ? (on as Record<string, unknown>).pull_request : undefined
  const paths = trigger !== null && typeof trigger === 'object' ? (trigger as Record<string, unknown>).paths : undefined
  return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : []
}

/**
 * Whether a change to `file` starts the workflow: GitHub reads the patterns in order, a `!` one taking a
 * file back out. `matchesGlob` reads `*` and `**` as GitHub does, but not `?` and `+` (GitHub's: zero or
 * one, and one or more, of the character before), braces or brackets (which GitHub's cheat sheet doesn't
 * define), so a pattern with one of those is refused rather than read the wrong way. Its `**` also
 * skips names that start with a dot, which can only fail a folder GitHub would start on: a false red.
 */
const startsOn = (paths: string[], file: string): boolean =>
  paths.reduce((starts, pattern) => {
    const glob = pattern.startsWith('!') ? pattern.slice(1) : pattern
    const unread = [...glob].find((character) => '?+{}[]'.includes(character))
    if (unread) throw new Error(`The Mutants workflow's path ${pattern} has ${unread}, which this test doesn't read as GitHub does`)
    return pattern.startsWith('!') ? starts && !matchesGlob(file, glob) : starts || matchesGlob(file, glob)
  }, false)

/**
 * The files the type check takes: those of every config `tsc -b` reaches from tsconfig.json through
 * references, as TypeScript resolves their include and exclude. A config's files and references are
 * relative to its own folder; a reference may name a folder, which means its tsconfig.json.
 */
const typeChecked = (root: string): Set<string> => {
  const checked = new Set<string>()
  const seen = new Set<string>()
  const visit = (config: string) => {
    if (seen.has(config)) return
    seen.add(config)
    const shown = JSON.parse(execFileSync(process.execPath, [TSC, '--showConfig', '-p', config], { cwd: root, encoding: 'utf8' })) as {
      references?: { path: string }[]
      files?: string[]
    }
    const folder = dirname(config)
    for (const file of shown.files ?? []) checked.add(relative(root, join(folder, file)).split('\\').join('/'))
    for (const reference of shown.references ?? []) {
      const path = join(folder, reference.path)
      visit(path.endsWith('.json') ? path : join(path, 'tsconfig.json'))
    }
  }
  visit(join(root, 'tsconfig.json'))
  return checked
}

describe("checks.json's mutated folders", () => {
  const folders = checks.mutants.folders
  let checked: Set<string> | undefined

  it.each(folders)('starts the Mutants workflow on a change to any file in %s', (folder) => {
    const paths = pullRequestPaths(readFileSync(join(ROOT, '.github/workflows/mutants.yml'), 'utf8'))
    expect(filesIn(ROOT, folder).filter((file) => !startsOn(paths, file))).toEqual([])
  })

  it.each(folders)('has the type check take every TypeScript file in %s', (folder) => {
    checked ??= typeChecked(ROOT)
    expect(filesIn(ROOT, folder).filter((file) => isTypeScript(file) && !checked?.has(file))).toEqual([])
  })
})

describe('reading the Mutants workflow', () => {
  const workflow = (paths: string) => `on:\n  pull_request:\n    types: [opened]\n${paths}\n  workflow_dispatch:\n`

  // The spellings that start the workflow on a change to scripts/guard/signs/read.ts, and those that don't.
  it.each([
    ['a quoted folder glob', "    paths:\n      - 'scripts/guard/**'"],
    ['an unquoted one', '    paths:\n      - scripts/guard/**'],
    ['a double-quoted one', '    paths:\n      - "scripts/guard/**"'],
    ['a parent folder', "    paths:\n      - 'scripts/**'"],
    ['every file', "    paths:\n      - '**'"],
    ['a flow sequence', "    paths: ['src/**', 'scripts/guard/**']"],
    ['a negation of something else', "    paths:\n      - 'scripts/**'\n      - '!scripts/size/**'"],
    ['a negation taken back by a later pattern', "    paths:\n      - 'scripts/**'\n      - '!scripts/guard/**'\n      - 'scripts/guard/signs/**'"],
    ['a quoted key', "    'paths':\n      - 'scripts/guard/**'"],
  ])('starts on %s', (_, paths) => {
    expect(startsOn(pullRequestPaths(workflow(paths)), 'scripts/guard/signs/read.ts')).toBe(true)
  })

  it.each([
    ['another folder', "    paths:\n      - 'scripts/size/**'"],
    ['a prefix of the name', "    paths:\n      - 'scripts/guar/**'"],
    ['a name it begins with', "    paths:\n      - 'scripts/guard*'"],
    ['one level only', "    paths:\n      - 'scripts/guard/*'"],
    ['a commented-out pattern', "    paths:\n      # - 'scripts/guard/**'\n      - 'src/**'"],
    ['a later negation', "    paths:\n      - 'scripts/guard/**'\n      - '!scripts/guard/signs/**'"],
    ['paths-ignore', "    paths-ignore:\n      - 'scripts/guard/**'"],
    ['no filter at all', ''],
  ])("doesn't start on %s", (_, paths) => {
    expect(startsOn(pullRequestPaths(workflow(paths)), 'scripts/guard/signs/read.ts')).toBe(false)
  })

  // What matchesGlob reads otherwise than GitHub is refused, a negation's too.
  it.each(['scripts/gua?d/**', 'scripts/guard+/**', '{src,scripts}/**', 'scripts/[g]uard/**', '!scripts/gua?d/**'])('refuses %s', (pattern) => {
    expect(() => startsOn(['scripts/**', pattern], 'scripts/guard/guard.ts')).toThrow(`path ${pattern} has`)
  })

  it("doesn't take another trigger's paths", () => {
    const text = "on:\n  push:\n    paths:\n      - 'scripts/guard/**'\n  pull_request:\n    paths:\n      - 'src/**'\n"
    expect(startsOn(pullRequestPaths(text), 'scripts/guard/guard.ts')).toBe(false)
  })

  it.each([
    ['a trigger without settings', 'on: pull_request\n'],
    ['a list of triggers', 'on: [push, pull_request]\n'],
    ['an empty file', ''],
  ])('reads %s as no filter', (_, text) => {
    expect(pullRequestPaths(text)).toEqual([])
  })
})

let root: string | undefined

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = undefined
})

/** A git repository with these files, added to its index. */
const repository = (files: Record<string, string>): string => {
  const made = mkdtempSync(join(tmpdir(), 'kinopeer-checks-'))
  root = made
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(made, name)), { recursive: true })
    writeFileSync(join(made, name), text)
  }
  execFileSync('git', ['init', '-q'], { cwd: made })
  execFileSync('git', ['add', '-A'], { cwd: made })
  return made
}

describe("listing a folder's files", () => {
  it('lists the files git tracks, new ones it doesn\'t ignore, and nothing ignored or deleted', () => {
    const made = repository({ '.gitignore': '.wrangler/\n', 'tmdb-proxy/worker.ts': '', 'tmdb-proxy/.wrangler/tmp/entry.ts': '', 'tmdb-proxy/gone.ts': '' })
    writeFileSync(join(made, 'tmdb-proxy/new.ts'), '')
    rmSync(join(made, 'tmdb-proxy/gone.ts'))
    expect(filesIn(made, 'tmdb-proxy').sort()).toEqual(['tmdb-proxy/new.ts', 'tmdb-proxy/worker.ts'])
  })

  it("doesn't list a folder whose name another begins with", () => {
    const made = repository({ 'scripts/guard/guard.ts': '', 'scripts/guard-old/old.ts': '' })
    expect(filesIn(made, 'scripts/guard')).toEqual(['scripts/guard/guard.ts'])
  })
})

describe('reading the type check', () => {
  /** A repository with scripts/guard/guard.ts and scripts/guard/signs/read.ts, type-checked by tsconfig.json's references. */
  const project = (configs: Record<string, string>, references = Object.keys(configs)) => {
    const made = repository({
      'scripts/guard/guard.ts': 'export {}\n',
      'scripts/guard/signs/read.ts': 'export {}\n',
      'tsconfig.json': JSON.stringify({ files: [], references: references.map((path) => ({ path: `./${path}` })) }),
      ...configs,
    })
    const checked = typeChecked(made)
    return filesIn(made, 'scripts/guard').filter((file) => !checked.has(file)).sort()
  }

  // The spellings that take both files, and those that leave one out.
  it.each([
    ['the folder', '{ "include": ["scripts/guard"] }'],
    ['the folder with a slash', '{ "include": ["scripts/guard/"] }'],
    ['the folder from ./', '{ "include": ["./scripts/guard"] }'],
    ['a glob of its files', '{ "include": ["scripts/guard/**/*"] }'],
    ['a parent folder', '{ "include": ["scripts"] }'],
    ['comments and a trailing comma', '{\n  // the guard\n  "include": [\n    /* its folder */ "scripts/guard",\n  ],\n}'],
    ['an exclude of something else', '{ "include": ["scripts"], "exclude": ["scripts/size"] }'],
  ])('takes every file with %s', (_, config) => {
    expect(project({ 'tsconfig.node.json': config })).toEqual([])
  })

  it('takes the files across several configs', () => {
    expect(project({ 'tsconfig.a.json': '{ "include": ["scripts/guard/*.ts"] }', 'tsconfig.b.json': '{ "include": ["scripts/guard/signs"] }' })).toEqual([])
  })

  it.each([
    ['another folder', '{ "include": ["scripts/size"] }', ['scripts/guard/guard.ts', 'scripts/guard/signs/read.ts']],
    ['a prefix of the name', '{ "include": ["scripts/guar"] }', ['scripts/guard/guard.ts', 'scripts/guard/signs/read.ts']],
    ['one level only', '{ "include": ["scripts/guard/*"] }', ['scripts/guard/signs/read.ts']],
    ['an exclude of a subfolder', '{ "include": ["scripts/guard"], "exclude": ["scripts/guard/signs"] }', ['scripts/guard/signs/read.ts']],
    ['a commented-out entry', '{ "include": [\n  // "scripts/guard",\n  "scripts/size"\n] }', ['scripts/guard/guard.ts', 'scripts/guard/signs/read.ts']],
  ])('leaves a file out with %s', (_, config, missing) => {
    expect(project({ 'tsconfig.node.json': config })).toEqual(missing)
  })

  it.each([
    ['a config in a folder of its own', { 'tools/tsconfig.json': '{ "include": ["../scripts/guard"] }' }, ['tools/tsconfig.json']],
    ['a reference that names the folder', { 'tools/tsconfig.json': '{ "include": ["../scripts/guard"] }' }, ['tools']],
    [
      "a referenced config's own reference",
      { 'tsconfig.base.json': '{ "files": [], "references": [{ "path": "./tools/tsconfig.guard.json" }] }', 'tools/tsconfig.guard.json': '{ "include": ["../scripts/guard"] }' },
      ['tsconfig.base.json'],
    ],
  ] as const)('takes every file through %s', (_, configs, references) => {
    expect(project(configs, [...references])).toEqual([])
  })

  it("leaves out a config tsconfig.json doesn't reference", () => {
    expect(project({ 'tsconfig.node.json': '{ "include": ["scripts/guard"] }' }, [])).toEqual(['scripts/guard/guard.ts', 'scripts/guard/signs/read.ts'])
  })
})
