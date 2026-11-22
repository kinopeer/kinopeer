// The Alternative WebUI's output check, which `npm run build:webui` runs after the build (package.json).
// qBittorrent changes three strings in every text file it serves an Alternative WebUI from
// (`WebApplication::translateDocument` in its src/webui/webapplication.cpp): `${LANG}` becomes its
// interface's language, `${CACHEID}` a random id and `QBT_TR(text)QBT_TR[CONTEXT=name]` a translation.
// A built file with one of them would reach the browser changed, so the build fails on any of them.
// `QBT_TR(` alone is enough: it starts every string qBittorrent translates, and more. Every file is
// read, images and fonts too: qBittorrent goes by the MIME type, which the check doesn't guess, and
// these strings don't turn up in a binary by chance.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** What qBittorrent replaces in a text file it serves (above). */
export const SUBSTITUTED = ['${LANG}', '${CACHEID}', 'QBT_TR('] as const

/** One of them in a built file: the file, the line (from 1) and the string. */
export interface Substitution {
  path: string
  line: number
  text: (typeof SUBSTITUTED)[number]
}

/** Each string qBittorrent would replace in `content`, the file at `path`, line by line. */
export function substitutionsIn(path: string, content: string): Substitution[] {
  return content.split('\n').flatMap((lineText, index) =>
    SUBSTITUTED.filter((text) => lineText.includes(text)).map((text) => ({ path, line: index + 1, text })),
  )
}

/**
 * Each string qBittorrent would replace in the files under `dir`. Throws when `dir` can't be read,
 * and on an entry that is neither a file nor a folder (a symlink), which qBittorrent refuses to serve.
 */
export function findSubstitutions(dir: string): Substitution[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .flatMap((entry) => {
      const full = join(entry.parentPath, entry.name)
      const path = relative(dir, full)
      if (!entry.isFile()) throw new Error(`\`${path}\` is neither a file nor a folder, which qBittorrent doesn't serve`)
      return substitutionsIn(path, readFileSync(full, 'latin1'))
    })
}

/** The verdict on the build in `dir`, with a line for each string found, or for why it couldn't look. */
export function main(dir: string): { passed: boolean; report: string } {
  let found: Substitution[]
  try {
    found = findSubstitutions(dir)
  } catch (error) {
    return { passed: false, report: `Can't check the WebUI build in ${dir}: ${(error as Error).message}` }
  }
  if (found.length === 0) return { passed: true, report: `The WebUI build in ${dir} has nothing qBittorrent would replace.` }
  const lines = found.map(({ path, line, text }) => `- ${path}:${line}: ${text}`)
  return { passed: false, report: [`qBittorrent would replace these strings in the WebUI build in ${dir}:`, ...lines].join('\n') }
}

// Run as a script rather than imported: `node scripts/webui/substitutions.ts <folder>`.
if (import.meta.main) {
  const { passed, report } = main(process.argv[2] ?? 'dist-webui')
  console.log(report)
  process.exitCode = passed ? 0 : 1
}
