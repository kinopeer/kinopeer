import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// Vitest runs from the project root (import.meta.url isn't a file URL under jsdom).
const ROOT = process.cwd()

interface Diagnostic {
  code: string
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
    const run = spawnSync(join(ROOT, 'node_modules/.bin/oxlint'), ['--disable-nested-config', '--format', 'json', ...Object.keys(files)], { cwd: root, encoding: 'utf8' })
    if (run.error) throw run.error
    const { diagnostics } = JSON.parse(run.stdout) as { diagnostics: Diagnostic[] }
    return diagnostics.map(({ code, filename, labels }) => ({ rule: code, file: filename, line: labels[0]?.span.line ?? 0 }))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
