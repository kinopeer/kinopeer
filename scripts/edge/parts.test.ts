import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { filesUnder, hashParts } from './parts.ts'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** A folder with these files in it, removed after the test. */
function folderWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'kinopeer-parts-test-'))
  folders.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

describe('hashParts', () => {
  const parts = [
    { path: 'dist/index.html', content: '<html>' },
    { path: 'server/main.js', content: 'run()' },
  ]

  it("doesn't depend on the parts' order", () => {
    expect(hashParts([...parts].reverse())).toBe(hashParts(parts))
  })

  it("changes with a part's content, path or presence", () => {
    const hash = hashParts(parts)
    expect(hashParts([parts[0], { ...parts[1], content: 'run(1)' }])).not.toBe(hash)
    expect(hashParts([parts[0], { ...parts[1], path: 'server/start.js' }])).not.toBe(hash)
    expect(hashParts([parts[0]])).not.toBe(hash)
  })

  it("keeps a part's path apart from its content", () => {
    expect(hashParts([{ path: 'a', content: 'bc' }])).not.toBe(hashParts([{ path: 'ab', content: 'c' }]))
  })

  it('takes bytes as well as text', () => {
    expect(hashParts([{ path: 'a', content: new TextEncoder().encode('bc') }])).toBe(hashParts([{ path: 'a', content: 'bc' }]))
  })

  it('refuses two parts with one path', () => {
    expect(() => hashParts([parts[0], { ...parts[0], content: 'other' }])).toThrow('Two parts named dist/index.html')
  })
})

describe('filesUnder', () => {
  it('reads every file in nested folders, with its path under the prefix', () => {
    const root = folderWith({ 'index.html': '<html>', 'assets/app.js': 'app()' })
    const files = filesUnder(root, 'dist').map(({ path, content }) => ({ path, content: content.toString() }))
    expect(files.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'dist/assets/app.js', content: 'app()' },
      { path: 'dist/index.html', content: '<html>' },
    ])
  })

  it("refuses an entry that isn't a file or a folder", () => {
    const root = folderWith({ 'index.html': '<html>' })
    symlinkSync(join(root, 'index.html'), join(root, 'link.html'))
    expect(() => filesUnder(root, 'dist')).toThrow('dist/link.html is neither a file nor a folder')
  })

  it("throws when the folder can't be read", () => {
    expect(() => filesUnder(join(tmpdir(), 'kinopeer-no-such-folder'), 'dist')).toThrow()
  })
})
