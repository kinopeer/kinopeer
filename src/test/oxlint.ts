import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// Vitest runs from the project root (import.meta.url isn't a file URL under jsdom).
const ROOT = process.cwd()

/** oxlint's own script, run with this Node, as `scripts/mutants.mjs` runs Stryker: `.bin`'s shim needs a shell on Windows. */
function oxlintBin(): string {
  const manifest = join(ROOT, 'node_modules/oxlint/package.json')
  return join(dirname(manifest), (JSON.parse(readFileSync(manifest, 'utf8')) as { bin: { oxlint: string } }).bin.oxlint)
}

interface Diagnostic {
  /** Missing when oxlint couldn't read the file, as for a parse error. */
  code?: string
  message: string
  filename: string
  labels: { span: { line: number } }[]
}

/** One problem oxlint found: the rule, and the file and line it found it on. */
export interface LintProblem {
  rule: string
  file: string
  line: number
}

/**
 * Lints files laid out as in the repository (`{ 'src/screens/A.tsx': '…' }`) with the root's
 * `.oxlintrc.json`, as `npm run lint` does, so a test can plant a violation where a rule applies and
 * see the config refuse it. The files go into a folder of their own beside a copy of the config,
 * since an override's globs are read from the config's folder.
 */
export function lint(files: Record<string, string>): LintProblem[] {
  const root = mkdtempSync(join(tmpdir(), 'oxlint-'))
  try {
    copyFileSync(join(ROOT, '.oxlintrc.json'), join(root, '.oxlintrc.json'))
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), content)
    }
    const run = spawnSync(process.execPath, [oxlintBin(), '--disable-nested-config', '--format', 'json', ...Object.keys(files)], { cwd: root, encoding: 'utf8' })
    if (run.error) throw run.error
    // 0 without problems, 1 with some; anything else, or no report, is oxlint refusing to run (a config it can't read, whose reason it prints where the report would be).
    let diagnostics: Diagnostic[] | undefined
    try {
      diagnostics = (JSON.parse(run.stdout) as { diagnostics: Diagnostic[] }).diagnostics
    } catch {
      // Reported below with what oxlint said.
    }
    if ((run.status !== 0 && run.status !== 1) || diagnostics === undefined) {
      throw new Error(`oxlint didn't run (exit ${run.status}): ${run.stderr}${run.stdout}`)
    }
    return diagnostics.map(({ code, message, filename, labels }) => {
      // A planted file oxlint couldn't read would pass every check of what a rule allows.
      if (code === undefined) throw new Error(`oxlint couldn't read ${filename}: ${message}`)
      return { rule: code, file: filename, line: labels[0]?.span.line ?? 0 }
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
