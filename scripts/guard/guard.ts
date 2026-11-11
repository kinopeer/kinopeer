// The checks guard: `npm run guard`, and CI's `guard` job on every PR, which runs main's copy of this
// script over the PR's branch (docs/QUALITY.md → The checks guard). It compares a branch with the
// commit it left main at and prints, as Markdown, what in its changes weakens the checks or changes
// existing ones. It reads the branch through git and runs none of its code.
import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { findings, readsWhole, report, type AddedLine, type Change, type Finding } from './signs.ts'

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
 * A diff as git itself makes it, whatever the caller's config and the branch's .gitattributes say:
 * no colors, no external diff tool or text converter, and every file as text, so a file marked
 * `-diff` still shows its lines. Renames off, so a renamed file is one removed and one added.
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

export type Options = { repo: string; base: string; head: string }

/** The guard over one branch: its findings and the report. */
export function guard({ repo, base, head }: Options): { found: Finding[]; report: string } {
  const git = gitIn(repo)
  const short = (rev: string) => git('rev-parse', '--short', rev).trim()
  // Where the branch left main, so what main gained since isn't read as the branch's loss.
  const from = git('merge-base', base, head).trim()
  const found = findings(changes(git, from, head))
  // The guard reads commits, so an author who runs it before committing would see "nothing" for the wrong reason.
  const dirty = head === 'HEAD' && git('status', '--porcelain') !== ''
  const text = report(found, { head: short(head), base: short(from) })
  return { found, report: dirty ? `${text}\n\nUncommitted changes aren't read: commit them and run it again.` : text }
}

/** `--repo`, `--base` and `--head` from the command line; main's remote branch and this checkout's HEAD by default. */
export function options(args: string[]): Options {
  const value = (name: string, fallback: string) => {
    const index = args.indexOf(`--${name}`)
    return index !== -1 && args[index + 1] ? args[index + 1] : fallback
  }
  return { repo: value('repo', '.'), base: value('base', 'origin/main'), head: value('head', 'HEAD') }
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
