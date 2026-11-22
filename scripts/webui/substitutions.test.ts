import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findSubstitutions, main, substitutionsIn } from './substitutions.ts'

/** A folder of its own per test, with a build in it. */
let root: string
const at = (path: string) => join(root, path)

async function write(files: Record<string, string | Buffer>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(at(path), '..'), { recursive: true })
    await writeFile(at(path), content)
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'webui-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('substitutionsIn', () => {
  // The strings qBittorrent's translateDocument replaces, as they'd appear in a bundle.
  it.each([
    ['the language', 'const lang = `${LANG}`', '${LANG}'],
    ['the cache id', 'fetch("/x?v=${CACHEID}")', '${CACHEID}'],
    ['a translation', 'QBT_TR(Download)QBT_TR[CONTEXT=App]', 'QBT_TR('],
    ['a translation without a context, which qBittorrent leaves alone but the check doesn’t', 'QBT_TR(Download)', 'QBT_TR('],
  ])('finds %s', (_what, content, text) => {
    expect(substitutionsIn('assets/index.js', content)).toEqual([{ path: 'assets/index.js', line: 1, text }])
  })

  it('names the line of each, and each of them on one line', () => {
    expect(substitutionsIn('index.html', 'one\n${LANG} and ${CACHEID}\nthree\nQBT_TR(x)')).toEqual([
      { path: 'index.html', line: 2, text: '${LANG}' },
      { path: 'index.html', line: 2, text: '${CACHEID}' },
      { path: 'index.html', line: 4, text: 'QBT_TR(' },
    ])
  })

  it.each([
    ['a template literal of another name', 'const x = `${LANGUAGE}`'],
    ['the name without its braces', 'LANG CACHEID'],
    ['qBittorrent’s name for it without the bracket', 'QBT_TR'],
  ])('passes %s', (_what, content) => {
    expect(substitutionsIn('assets/index.js', content)).toEqual([])
  })
})

describe('findSubstitutions', () => {
  it('reads every file under the folder, binaries too', async () => {
    await write({
      'index.html': '<html lang="${LANG}">',
      'assets/index.js': 'ok',
      'icons/icon.png': Buffer.concat([Buffer.from([0x89, 0xff, 0x00]), Buffer.from('QBT_TR(')]),
    })
    expect(findSubstitutions(root).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: join('icons', 'icon.png'), line: 1, text: 'QBT_TR(' },
      { path: 'index.html', line: 1, text: '${LANG}' },
    ])
  })

  it("fails on a symlink, which qBittorrent doesn't serve", async () => {
    await write({ 'index.html': 'ok' })
    await symlink(at('index.html'), at('linked.html'))
    expect(() => findSubstitutions(root)).toThrow('`linked.html` is neither a file nor a folder')
  })
})

describe('main', () => {
  it('passes a build with nothing qBittorrent would replace', async () => {
    await write({ 'index.html': '<html lang="en">', 'assets/index.js': 'const a = `${b}`' })
    expect(main(root)).toEqual({ passed: true, report: `The WebUI build in ${root} has nothing qBittorrent would replace.` })
  })

  it('fails a build with one, naming each', async () => {
    await write({ 'index.html': '<html>\n<p>${CACHEID}</p>' })
    expect(main(root)).toEqual({ passed: false, report: `qBittorrent would replace these strings in the WebUI build in ${root}:\n- index.html:2: \${CACHEID}` })
  })

  it("fails when it can't read the build, rather than passing it", () => {
    const { passed, report } = main(at('missing'))
    expect(passed).toBe(false)
    expect(report).toMatch(`Can't check the WebUI build in ${at('missing')}: ENOENT`)
  })
})
