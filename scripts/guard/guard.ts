// The checks guard: `npm run guard`, and CI's `guard` job on every PR, which runs main's copy of this
// script over the PR's branch (docs/QUALITY.md → The checks guard). It compares a branch with the
// commit it left main at and prints, as Markdown, what in its changes weakens the checks or changes
// existing ones. It reads the branch through git and runs none of its code.
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findings, readsWhole, report, type AddedLine, type Change, type Finding } from './signs.ts'
import { compareTests, testsIn, type Test } from './tests.ts'

type Git = (...args: string[]) => string

/** git in `repo`; throws on a failure, with what git said. */
export function gitIn(repo: string): Git {
  return (...args) => {
    // A path is a path: `e2e/[id].spec.ts` would otherwise be a pattern that also takes in `e2e/i.spec.ts`.
    const { status, stdout, stderr } = spawnSync('git', ['-C', repo, '--literal-pathspecs', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })
    if (status !== 0) throw new Error(`git ${args.join(' ')}: ${stderr}`)
    return stdout
  }
}

/**
 * A diff the guard can read under the caller's config and the branch's .gitattributes: no colors,
 * no external diff tool or text converter, and every file as text, so a file marked `-diff` still
 * shows its lines. Renames off, so a renamed file is one removed and one added. Lines of context
 * may still come (`diff.interHunkContext`, GIT_DIFF_OPTS), and `addedLines` counts them.
 */
const PLAIN = ['--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', '--text']

/** The lines `base..head` adds to one file, each with its number on the head's side. */
function addedLines(git: Git, base: string, head: string, path: string): AddedLine[] {
  const added: AddedLine[] = []
  let next = 0
  for (const text of git('diff', ...PLAIN, '--unified=0', base, head, '--', path).split('\n')) {
    const hunk = /^@@ -\S+ \+(\d+)/.exec(text)
    if (hunk) next = Number(hunk[1])
    // Before the first hunk come the file's header lines, `+++ b/path` among them.
    else if (next > 0 && text.startsWith('+')) added.push({ line: next++, text: text.slice(1) })
    // A line of context, which git's config or GIT_DIFF_OPTS can ask for whatever --unified says, is a line of the file too.
    else if (text.startsWith(' ')) next++
  }
  return added
}

/** What the branch at `head` changes since it left `base`, with the text the signs read. */
export function changes(git: Git, base: string, head: string): Change[] {
  // A file's text on one side, or undefined where that side doesn't have it or the guard doesn't read it whole.
  const read = (rev: string, path: string, exists: boolean) => (exists && readsWhole(path) ? git('show', `${rev}:${path}`) : undefined)
  // With -z git gives each path as it is, where it would otherwise quote one with a space or a non-ASCII letter.
  return git('diff', ...PLAIN, '--name-status', '-z', base, head)
    .split('\0')
    .reduce<Change[]>((all, path, index, fields) => {
      // The fields come in pairs, a status letter and then its path, with an empty one after the last.
      if (index % 2 === 0) return all
      const [added, deleted] = [fields[index - 1] === 'A', fields[index - 1] === 'D']
      return [...all, { path, base: read(base, path, !added), head: read(head, path, !deleted), added: deleted ? [] : addedLines(git, base, head, path) }]
    }, [])
}

/** The tests in a folder of reports (Vitest's JSON, Playwright's lists); none when there is no such folder. */
function testsOf(folder: string): Test[] {
  if (!existsSync(folder)) return []
  return readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    // By name, so the findings come in one order on every file system.
    .sort()
    .flatMap((name) => testsIn(readFileSync(join(folder, name), 'utf8')))
}

/** `tests`: the folders with the reports of main's run of the tests and of the branch's, when the caller has them. */
export type Options = { repo: string; base: string; head: string; tests?: { base: string; head: string } }

/** The guard over one branch: its findings and the report. */
export function guard({ repo, base, head, tests }: Options): { found: Finding[]; report: string } {
  const git = gitIn(repo)
  const short = (rev: string) => git('rev-parse', '--short', rev).trim()
  // Where the branch left main, so what main gained since isn't read as the branch's loss.
  const from = git('merge-base', base, head).trim()
  const found = [...findings(changes(git, from, head)), ...(tests ? compareTests(testsOf(tests.base), testsOf(tests.head)) : [])]
  // The guard reads commits, so an author who runs it before committing would see "nothing" for the wrong reason.
  const dirty = head === 'HEAD' && git('status', '--porcelain') !== ''
  const notes = [
    ...(tests ? [] : ["The tests that ran aren't compared: that takes a run of the tests on each side, which CI's `guard` workflow makes."]),
    ...(dirty ? ["Uncommitted changes aren't read: commit them and run it again."] : []),
  ]
  return { found, report: [report(found, { head: short(head), base: short(from) }), ...notes].join('\n\n') }
}

/**
 * `--repo`, `--base` and `--head` from the command line; main's remote branch and this checkout's
 * HEAD by default. `--tests-base` and `--tests-head` name the folders with the two runs' reports:
 * with either given the tests are compared, and a side without a folder is a run that gave no list.
 */
export function options(args: string[]): Options {
  const value = (name: string, fallback: string) => {
    const index = args.indexOf(`--${name}`)
    return index !== -1 && args[index + 1] ? args[index + 1] : fallback
  }
  const tests = { base: value('tests-base', ''), head: value('tests-head', '') }
  return { repo: value('repo', '.'), base: value('base', 'origin/main'), head: value('head', 'HEAD'), ...(tests.base || tests.head ? { tests } : {}) }
}

/**
 * The command: the report for the branch the arguments name. In CI it also hands the workflow the
 * counts, which decides by them rather than by the report's wording.
 */
export function main(args: string[], env: { GITHUB_OUTPUT?: string }): string {
  const { found, report: text } = guard(options(args))
  const count = (needs: Finding['needs']) => found.filter((finding) => finding.needs === needs).length
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `owner=${count('owner')}\nreview=${count('review')}\n`)
  return text
}

// Run as a script rather than imported, also through a symlinked folder.
if (import.meta.main) console.log(main(process.argv, process.env))
