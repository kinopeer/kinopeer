import { builtinModules } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import { lint, type LintProblem } from '../test/oxlint'

/**
 * Pure logic doesn't depend on the framework or the platform (docs/ARCHITECTURE.md → Pure logic):
 * every module in `src/releases/`, `src/search/`, `src/torrents/` and `src/logic/` but a hook or a
 * provider imports no React, React Router, i18next's React bindings, Node built-in, hook or component,
 * and reads no global but the language's own and the few every platform has. `no-restricted-imports`,
 * `no-undef` and `no-restricted-globals` in `.oxlintrc.json` hold it; these tests plant each kind in
 * those folders and beside them.
 */

const RULES = ['eslint(no-restricted-imports)', 'eslint(no-undef)', 'eslint(no-restricted-globals)']

const PURE_FOLDERS = ['src/releases', 'src/search', 'src/torrents', 'src/logic']

const REFUSED: [string, string][] = [
  ['React', "import { useState } from 'react'\nexport const a = useState"],
  ["React's types", "import type { ReactNode } from 'react'\nexport type A = ReactNode"],
  ['React DOM', "import { createRoot } from 'react-dom/client'\nexport const a = createRoot"],
  ['React Router', "import { useNavigate } from 'react-router'\nexport const a = useNavigate"],
  ["i18next's React bindings", "import { useTranslation } from 'react-i18next'\nexport const a = useTranslation"],
  ['a Node built-in by its node: name', "import { readFileSync } from 'node:fs'\nexport const a = readFileSync"],
  ['a Node built-in by its bare name', "import { join } from 'path'\nexport const a = join"],
  ['window', 'export const a = () => window.innerWidth'],
  ['document', 'export const a = () => document.title'],
  ['localStorage', "export const a = () => localStorage.getItem('kinopeer.a')"],
  ['sessionStorage', "export const a = () => sessionStorage.getItem('kinopeer.a')"],
  ['navigator', 'export const a = () => navigator.onLine'],
  ['location', 'export const a = () => location.href'],
  ['history', 'export const a = () => history.state'],
  ['matchMedia', "export const a = () => matchMedia('(min-width: 1024px)')"],
  ["Node's process", 'export const a = () => process.env.TZ'],
  ["Node's Buffer", "export const a = () => Buffer.from('a')"],
  ['a global through globalThis', 'export const a = () => globalThis.document'],
  ['a listener on the window', "export const a = () => addEventListener('online', () => {})"],
  ["the DOM's classes", 'export const a = (e: unknown) => e instanceof HTMLElement'],
  ['an event', "export const a = () => new CustomEvent('a')"],
  ['a dialog of the browser', "export const a = () => alert('a')"],
  ['an XMLHttpRequest', 'export const a = () => new XMLHttpRequest()'],
  ['a worker', "export const a = () => new Worker('a.js')"],
  ["Node's setImmediate", 'export const a = () => setImmediate(() => {})'],
  ["Node's module", 'export const a = () => module.exports'],
  ['a constant the build defines', 'export const a = () => __APP_VERSION__'],
  ['a hook', "import { useReleases } from '../screens/useReleases'\nexport const a = useReleases"],
  ['a hook beside the logic', "import { useTitleMatches } from './useTitleMatches'\nexport const a = useTitleMatches"],
  ['a hook of the app’s own library', "import { useIsDesktop } from '../lib/useIsDesktop'\nexport const a = useIsDesktop"],
  ['a component', "import { Sheet } from '../components/Sheet'\nexport const a = Sheet"],
  ['a screen', "import { SearchScreen } from '../screens/SearchScreen'\nexport const a = SearchScreen"],
]

/** Every module Node has, by its bare name: a module a later Node adds fails here, not in production. */
const BUILT_INS = builtinModules.map((name) => [name, `import * as a from '${name}'\nexport { a }`] as const)

const ALLOWED: [string, string][] = [
  ['i18next itself', "import type { TFunction } from 'i18next'\nexport type A = TFunction"],
  ["the app's API clients", "import { getTorrents } from '../api/qbittorrent'\nexport const a = getTorrents"],
  ['what every platform has', "export const a = async (url: string) => {\n  setTimeout(() => {}, 1)\n  return [new URL(url), await crypto.subtle.digest('SHA-1', new Uint8Array()), await fetch(url)]\n}"],
  ['a variable named like a global', "export function a(history: string[], location: string) {\n  return [...history, location]\n}"],
  ["a hook's or a component's types", "import type { Releases } from '../screens/useReleases'\nimport { type SheetProps } from '../components/Sheet'\nexport type A = [Releases, SheetProps]"],
  ['the language’s own globals', 'export const a = () => [new Map(), Promise.resolve(), Intl.DateTimeFormat, Math.max(1), JSON.parse("1")]'],
]

describe('pure modules', () => {
  let problems: LintProblem[]
  const at = (file: string) => problems.filter((problem) => RULES.includes(problem.rule) && problem.file === file)
  const refused = [
    ...PURE_FOLDERS.flatMap((folder) => REFUSED.map(([what, code], index) => ({ what, code, file: `${folder}/refused${index}.ts` }))),
    ...BUILT_INS.map(([name, code], index) => ({ what: `Node's ${name}`, code, file: `src/torrents/builtIn${index}.ts` })),
    // Named like a hook's file, but no hook: `use` and a capital letter make one.
    { what: 'React in a module whose name starts with use', code: REFUSED[0][1], file: 'src/torrents/user.ts' },
    { what: 'React in a component', code: `${REFUSED[0][1]}\nexport const B = () => <p>{a.name}</p>`, file: 'src/torrents/Example.tsx' },
  ]

  beforeAll(() => {
    problems = lint({
      ...Object.fromEntries(refused.map(({ code, file }) => [file, code])),
      ...Object.fromEntries(ALLOWED.map(([, code], index) => [`src/torrents/allowed${index}.ts`, code])),
      'src/torrents/useExample.ts': REFUSED[0][1],
      'src/torrents/ExampleProvider.tsx': REFUSED[0][1],
      'src/torrents/example.test.ts': REFUSED[0][1],
      'src/torrents/example.test.tsx': REFUSED[0][1],
      'src/lib/example.ts': REFUSED[0][1],
    })
  })

  it.each(refused.map(({ what, file }) => [what, file]))('refuses %s in %s', (_what, file) => {
    expect(at(file)).toHaveLength(1)
  })

  it.each(ALLOWED.map(([what], index) => [what, index] as const))('allows %s', (_what, index) => {
    expect(at(`src/torrents/allowed${index}.ts`)).toEqual([])
  })

  it.each(['src/torrents/useExample.ts', 'src/torrents/ExampleProvider.tsx', 'src/torrents/example.test.ts', 'src/torrents/example.test.tsx', 'src/lib/example.ts'])(
    'leaves alone a hook, a provider, a test or a module outside the pure folders: %s',
    (file) => {
      expect(at(file)).toEqual([])
    },
  )
})
