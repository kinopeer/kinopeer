// Community Applications clones a repository and reads every XML file in it as a template (its feed
// lists other repositories' Android manifests as "Not an unRaid Application"), so the repository holds
// only its two (#512): CA's profile at the root and Kinopeer's template. A fixture written as an .xml
// file would go to Unraid's Apps tab as a broken app, or fail CA's scan. The template's screenshots,
// which CA shows from main, are checked here too, since Stryker's sandbox has no docs/. The files are
// the repository's as git lists them, tracked and new, so the tests can't run in that sandbox, which
// isn't a checkout: checks.json leaves this file out of its runs.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

it('finds no XML in the repository but CA’s profile and the template', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.xml'], { cwd: ROOT, encoding: 'utf8' })
  expect(files.split('\0').filter(Boolean).sort()).toEqual(['ca_profile.xml', 'unraid/kinopeer.xml'])
})

it('finds each of the template’s screenshots among the repository’s files, at its address on main', () => {
  const raw = 'https://raw.githubusercontent.com/kinopeer/kinopeer/main/'
  const template = readFileSync(join(ROOT, 'unraid/kinopeer.xml'), 'utf8')
  const screenshots = [...template.matchAll(/<Screenshot>(.*?)<\/Screenshot>/g)].map((match) => match[1])
  expect(screenshots.length).toBeGreaterThan(0)
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'docs/screenshots'], { cwd: ROOT, encoding: 'utf8' }).split('\0')
  for (const address of screenshots) {
    expect(address.startsWith(raw)).toBe(true)
    expect(files).toContain(address.slice(raw.length))
  }
})
