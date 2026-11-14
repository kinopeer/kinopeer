// checks.json holds the folders scripts/mutants.mjs mutates; two places have to name them again, since
// neither can read checks.json: the paths that start the Mutants workflow and the type check's
// tsconfigs. A folder added to checks.json and missed in one of them (#379, #388) left its changes
// unmutated or unchecked. Each place is read with its own format's parser: the workflow with a YAML
// parser and the tsconfigs by TypeScript itself (`tsc --showConfig`, which lists the files a config
// takes), never with regular expressions (docs/TESTING.md → Choosing a layer's edges).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, matchesGlob, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const ROOT = dirname(fileURLToPath(import.meta.url))
const TSC = join(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin', 'tsc')

const checks = JSON.parse(readFileSync(join(ROOT, 'checks.json'), 'utf8')) as { mutants: { folders: string[] } }

/** Every file under a folder, relative to `root` and with `/`, leaving out installed packages. */
const filesIn = (root: string, folder: string): string[] =>
  readdirSync(join(root, folder), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .filter((path) => !path.split('/').includes('node_modules'))

const isTypeScript = (path: string): boolean => /\.(m|c)?tsx?$/.test(path)

/** The `paths` filter of a workflow's `pull_request` trigger, as GitHub reads it; empty when it has none. */
const pullRequestPaths = (workflow: string): string[] => {
  const on = (parse(workflow) as { on?: unknown } | null)?.on
  const trigger = on !== null && typeof on === 'object' ? (on as Record<string, unknown>).pull_request : undefined
  const paths = trigger !== null && typeof trigger === 'object' ? (trigger as Record<string, unknown>).paths : undefined
  return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : []
}

/** Whether a change to `file` starts the workflow: GitHub reads the patterns in order, a `!` one taking a file back out. */
const startsOn = (paths: string[], file: string): boolean =>
  paths.reduce((starts, pattern) => (pattern.startsWith('!') ? starts && !matchesGlob(file, pattern.slice(1)) : starts || matchesGlob(file, pattern)), false)

/** The files the type check takes: those of every config tsconfig.json references, as TypeScript resolves their include and exclude. */
const typeChecked = (root: string): Set<string> => {
  const showConfig = (config: string) =>
    JSON.parse(execFileSync(process.execPath, [TSC, '--showConfig', '-p', join(root, config)], { cwd: root, encoding: 'utf8' })) as {
      references?: { path: string }[]
      files?: string[]
    }
  const configs = (showConfig('tsconfig.json').references ?? []).map((reference) => reference.path)
  return new Set(configs.flatMap((config) => (showConfig(config).files ?? []).map((file) => relative(root, join(root, file)).split('\\').join('/'))))
}

describe("checks.json's mutated folders", () => {
  const folders = checks.mutants.folders

  it.each(folders)('starts the Mutants workflow on a change to any file in %s', (folder) => {
    const paths = pullRequestPaths(readFileSync(join(ROOT, '.github/workflows/mutants.yml'), 'utf8'))
    expect(filesIn(ROOT, folder).filter((file) => !startsOn(paths, file))).toEqual([])
  })

  it.each(folders)('has the type check take every TypeScript file in %s', (folder) => {
    const checked = typeChecked(ROOT)
    expect(filesIn(ROOT, folder).filter((file) => isTypeScript(file) && !checked.has(file))).toEqual([])
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

describe('reading the type check', () => {
  let root: string | undefined

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = undefined
  })

  /** A repository with scripts/guard/guard.ts and scripts/guard/signs/read.ts, type-checked by tsconfig.json's references. */
  const project = (configs: Record<string, string>, references = Object.keys(configs)) => {
    root = mkdtempSync(join(tmpdir(), 'kinopeer-checks-'))
    mkdirSync(join(root, 'scripts/guard/signs'), { recursive: true })
    writeFileSync(join(root, 'scripts/guard/guard.ts'), 'export {}\n')
    writeFileSync(join(root, 'scripts/guard/signs/read.ts'), 'export {}\n')
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ files: [], references: references.map((path) => ({ path: `./${path}` })) }))
    for (const [name, text] of Object.entries(configs)) writeFileSync(join(root, name), text)
    const checked = typeChecked(root)
    return filesIn(root, 'scripts/guard').filter((file) => !checked.has(file)).sort()
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

  it("leaves out a config tsconfig.json doesn't reference", () => {
    expect(project({ 'tsconfig.node.json': '{ "include": ["scripts/guard"] }' }, [])).toEqual(['scripts/guard/guard.ts', 'scripts/guard/signs/read.ts'])
  })
})
