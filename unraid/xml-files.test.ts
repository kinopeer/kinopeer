// Community Applications' docs don't say which XML files in a repository it reads as templates
// (ca.unraid.net/submit/help), so the repository holds only its two (#512): CA's profile at the root
// and Kinopeer's template. A fixture written as an .xml file would go to Unraid's Apps tab as a broken
// app, or fail CA's scan. The files are the repository's as git lists them, tracked and new, so the
// test can't run in Stryker's sandbox, which isn't a checkout: checks.json leaves it out of its runs.
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

it('finds no XML in the repository but CA’s profile and the template', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.xml'], { cwd: ROOT, encoding: 'utf8' })
  expect(files.split('\0').filter(Boolean).sort()).toEqual(['ca_profile.xml', 'unraid/kinopeer.xml'])
})
