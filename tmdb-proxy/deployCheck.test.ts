import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { shouldDeploy } from './deployCheck.ts'

const repos: string[] = []

/** A git repository with one commit of the proxy, as the workflow's checkout has it. */
function repo() {
  const cwd = mkdtempSync(join(tmpdir(), 'kinoseed-proxy-'))
  repos.push(cwd)
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'tag.gpgsign', 'false')
  const commit = (files: Record<string, string>) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true })
      writeFileSync(join(cwd, path), content)
    }
    git('add', '-A')
    git('commit', '-q', '-m', Object.keys(files).join(' '))
    return git('rev-parse', 'HEAD')
  }
  /** Where the workflow's checkout stands, and what it fetched of main. */
  const at = (sha: string, main = sha) => {
    git('checkout', '-q', '--detach', sha)
    git('update-ref', 'refs/remotes/origin/main', main)
  }
  const tag = (name: string, sha: string) => git('tag', name, sha)
  const first = commit({ 'tmdb-proxy/worker.ts': 'v1', 'README.md': 'readme' })
  return { cwd, commit, at, tag, first }
}

afterEach(() => {
  for (const cwd of repos.splice(0)) rmSync(cwd, { recursive: true, force: true })
})

describe('shouldDeploy', () => {
  describe('edge', () => {
    it('deploys main’s head', () => {
      const { cwd, at, first } = repo()
      at(first)

      expect(shouldDeploy('edge', cwd)).toMatchObject({ deploy: true })
    })

    it('deploys an older commit when main moved on without touching the proxy', () => {
      const { cwd, commit, at, first } = repo()
      const docs = commit({ 'README.md': 'more' })
      at(first, docs)

      expect(shouldDeploy('edge', cwd)).toMatchObject({ deploy: true })
    })

    it('deploys an older commit when main changed only the proxy’s tests', () => {
      const { cwd, commit, at, first } = repo()
      const tests = commit({ 'tmdb-proxy/worker.test.ts': 'test' })
      at(first, tests)

      expect(shouldDeploy('edge', cwd)).toMatchObject({ deploy: true })
    })

    it('leaves the worker when main has newer proxy code', () => {
      const { cwd, commit, at, first } = repo()
      const newer = commit({ 'tmdb-proxy/worker.ts': 'v2' })
      at(first, newer)

      expect(shouldDeploy('edge', cwd)).toMatchObject({ deploy: false })
    })

    it('leaves the worker when main has a newer Wrangler config', () => {
      const { cwd, commit, at, first } = repo()
      const newer = commit({ 'tmdb-proxy/wrangler.toml': 'limit = 50' })
      at(first, newer)

      expect(shouldDeploy('edge', cwd)).toMatchObject({ deploy: false })
    })
  })

  describe('release', () => {
    it('deploys the highest tag', () => {
      const { cwd, commit, at, tag, first } = repo()
      tag('v0.6.1', first)
      const next = commit({ 'tmdb-proxy/worker.ts': 'v2' })
      tag('v0.7.0', next)
      at(next)

      expect(shouldDeploy('release', cwd)).toMatchObject({ deploy: true })
    })

    it('leaves the worker for an older tag when the proxy changed since', () => {
      const { cwd, commit, at, tag, first } = repo()
      tag('v0.6.1', first)
      tag('v0.7.0', commit({ 'tmdb-proxy/worker.ts': 'v2' }))
      at(first)

      expect(shouldDeploy('release', cwd)).toMatchObject({ deploy: false })
    })

    it('deploys an older tag when the proxy is the same as the highest one’s', () => {
      const { cwd, commit, at, tag, first } = repo()
      tag('v0.6.1', first)
      tag('v0.6.2', commit({ 'README.md': 'more' }))
      at(first)

      expect(shouldDeploy('release', cwd)).toMatchObject({ deploy: true })
    })

    it('ranks a release above its prerelease', () => {
      const { cwd, commit, at, tag, first } = repo()
      tag('v0.7.0-rc.1', first)
      const release = commit({ 'tmdb-proxy/worker.ts': 'v2' })
      tag('v0.7.0', release)
      at(release)

      expect(shouldDeploy('release', cwd)).toMatchObject({ deploy: true })
      at(first)
      expect(shouldDeploy('release', cwd)).toMatchObject({ deploy: false })
    })

    it('compares versions by number, not as text', () => {
      const { cwd, commit, at, tag, first } = repo()
      tag('v0.9.0', first)
      const tenth = commit({ 'tmdb-proxy/worker.ts': 'v2' })
      tag('v0.10.0', tenth)
      at(tenth)

      expect(shouldDeploy('release', cwd)).toMatchObject({ deploy: true })
    })

    it('ignores tags that aren’t versions', () => {
      const { cwd, commit, at, tag, first } = repo()
      tag('v0.6.1', first)
      tag('vacation', commit({ 'tmdb-proxy/worker.ts': 'v2' }))
      at(first)

      expect(shouldDeploy('release', cwd)).toMatchObject({ deploy: true })
    })
  })

  it('deploys nothing to the release worker before the first version tag', () => {
    const { cwd, at, first } = repo()
    at(first)

    expect(shouldDeploy('release', cwd)).toMatchObject({ deploy: false })
  })

  it('fails rather than skipping when git can’t compare', () => {
    const { cwd, first } = repo()
    execFileSync('git', ['checkout', '-q', '--detach', first], { cwd })

    expect(() => shouldDeploy('edge', cwd)).toThrow('git diff failed')
  })

  it('refuses an environment it doesn’t know', () => {
    const { cwd, at, first } = repo()
    at(first)

    expect(() => shouldDeploy('staging', cwd)).toThrow('Unknown environment staging')
  })
})
