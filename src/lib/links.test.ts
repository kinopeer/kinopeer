import { describe, expect, it } from 'vitest'
import { BUG_REPORT_URL, IDEAS_URL, REPO_URL } from './links'

describe('links', () => {
  it('point at the repository and its Ideas category', () => {
    expect(REPO_URL).toBe('https://github.com/kinopeer/kinopeer')
    expect(IDEAS_URL).toBe('https://github.com/kinopeer/kinopeer/discussions/categories/ideas')
  })

  it('open the bug report form with the running version filled in', () => {
    const url = new URL(BUG_REPORT_URL)
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/kinopeer/kinopeer/issues/new')
    expect(url.searchParams.get('template')).toBe('bug_report.yml')
    expect(url.searchParams.get('version')).toBe(__APP_VERSION__)
  })
})
