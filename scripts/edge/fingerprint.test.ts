import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { dockerfileInstructions, fingerprint, main, runtimePackage, serverBundle } from './fingerprint.ts'
import { filesUnder, hashParts } from './parts.ts'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** A folder with these files in it, removed after the test. */
function folderWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'kinopeer-fingerprint-test-'))
  folders.push(root)
  write(root, files)
  return root
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
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

describe('dockerfileInstructions', () => {
  it('drops comments and blank lines, indented ones and Windows line ends included', () => {
    const text = '# Build\r\nFROM node AS build\r\n\r\n \t\n  # copied below\nRUN npm ci && \\\n    # the build\n    npm run build\n'
    expect(dockerfileInstructions(text)).toBe('FROM node AS build\nRUN npm ci && \\\n    npm run build')
  })

  it('keeps a # inside an instruction', () => {
    expect(dockerfileInstructions('RUN echo "#1"')).toBe('RUN echo "#1"')
  })
})

describe('runtimePackage', () => {
  it('keeps the type and version and leaves out what only builds', () => {
    const text = JSON.stringify({ name: 'kinopeer', version: '1.0.0', type: 'module', scripts: { dev: 'vite' }, devDependencies: { vite: '^8' } })
    expect(runtimePackage(text)).toBe('{"type":"module","version":"1.0.0"}')
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

// A small server in the shape of the real one: an entry that imports a module and a Node built-in,
// in a package of ES modules.
const server = {
  'package.json': JSON.stringify({ type: 'module' }),
  'server/main.ts': "import { join } from 'node:path'\nimport { greeting } from './greeting.ts'\n\nconsole.log(join('a', greeting('b')))\n",
  'server/greeting.ts': '/** Says hello. */\nexport function greeting(name: string): string {\n  const words = `hello ${name}`\n  return words\n}\n',
}

// What says how the image is built (BUILD_FILES).
const buildFiles = { '.dockerignore': 'node_modules\n', '.github/workflows/edge.yml': 'name: Edge\n' }

describe('serverBundle', () => {
  it("gives the same bundle when only comments, formatting and local names change", async () => {
    const before = await serverBundle(folderWith(server), 'server/main.ts')
    const after = await serverBundle(
      folderWith({
        ...server,
        'server/greeting.ts': '// Greets.\nexport function greeting(name: string): string {\n  const text =\n    `hello ${name}`\n  return text\n}\n',
      }),
      'server/main.ts',
    )
    expect(hashParts(after)).toBe(hashParts(before))
  })

  it('gives another bundle when what runs changes', async () => {
    const before = await serverBundle(folderWith(server), 'server/main.ts')
    const after = await serverBundle(
      folderWith({ ...server, 'server/greeting.ts': server['server/greeting.ts'].replace('`hello', '`hi') }),
      'server/main.ts',
    )
    expect(hashParts(after)).not.toBe(hashParts(before))
  })

  it('leaves no folder of its own behind', async () => {
    const temp = folderWith({})
    await serverBundle(folderWith(server), 'server/main.ts', temp)
    expect(readdirSync(temp)).toEqual([])
  })

  it("names its files under server/, and has none of public/'s, which dist/ has", async () => {
    const parts = await serverBundle(folderWith({ ...server, 'public/favicon.svg': '<svg/>' }), 'server/main.ts')
    expect(parts.map((part) => part.path)).toEqual(['server/main.js'])
  })
})

describe('fingerprint', () => {
  const project = {
    ...server,
    ...buildFiles,
    Dockerfile: '# The image\nFROM node\nCOPY server ./server\n',
    'package.json': JSON.stringify({ version: '1.0.0', type: 'module', scripts: { test: 'vitest' } }),
    'dist/index.html': '<html>',
  }
  const of = (files: Record<string, string>, proxy = 'https://proxy.example.com/3') => {
    const root = folderWith(files)
    return fingerprint({ root, dist: join(root, 'dist'), proxy })
  }

  it("stays when only what doesn't reach the running image changes", async () => {
    const hash = await of(project)
    expect(
      await of({
        ...project,
        Dockerfile: `# Another comment\n${project.Dockerfile}`,
        'package.json': JSON.stringify({ version: '1.0.0', type: 'module', scripts: { test: 'vitest run' } }),
      }),
    ).toBe(hash)
  })

  it('changes with the app, the server, the Dockerfile, the runtime package fields, the proxy, .dockerignore or the Edge workflow', async () => {
    const hash = await of(project)
    const changed = await Promise.all([
      of({ ...project, 'dist/index.html': '<html lang="en">' }),
      of({ ...project, 'server/main.ts': project['server/main.ts'].replace("'a'", "'c'") }),
      of({ ...project, Dockerfile: project.Dockerfile.replace('FROM node', 'FROM node:24') }),
      of({ ...project, 'package.json': JSON.stringify({ version: '1.0.1', type: 'module' }) }),
      of(project, 'https://other.example.com/3'),
      of({ ...project, '.dockerignore': 'node_modules\nsrc/test\n' }),
      of({ ...project, '.github/workflows/edge.yml': 'name: Edge\n# BuildKit moved\n' }),
    ])
    for (const other of changed) expect(other).not.toBe(hash)
  })

  it('fails without a file that says how the image is built', async () => {
    const { '.dockerignore': _, ...rest } = project
    await expect(of(rest)).rejects.toThrow('.dockerignore')
  })
})

describe('main', () => {
  const project = { ...server, ...buildFiles, Dockerfile: 'FROM node\n', 'dist/index.html': '<html>' }

  it('gives the fingerprint of the project it runs in, with the build folder relative to it', async () => {
    const root = folderWith(project)
    const proxy = 'https://proxy.example.com/3'
    expect(await main(['dist', proxy], root)).toEqual({ code: 0, out: await fingerprint({ root, dist: join(root, 'dist'), proxy }) })
  })

  it("takes an empty proxy address, as an image built without one has (the Dockerfile's default)", async () => {
    expect((await main(['dist', ''], folderWith(project))).code).toBe(0)
  })

  it('says how to run it, and fails, without the build folder or the proxy address', async () => {
    const usage = { code: 2, out: 'Usage: node scripts/edge/fingerprint.ts <dist> <proxy>' }
    expect(await main([], tmpdir())).toEqual(usage)
    expect(await main(['dist'], tmpdir())).toEqual(usage)
    expect(await main(['', 'https://proxy.example.com/3'], tmpdir())).toEqual(usage)
  })
})

// What edge.yml runs: the script itself, in a child process, where Stryker's mutants don't reach.
describe('the script', () => {
  const script = fileURLToPath(new URL('./fingerprint.ts', import.meta.url))
  const run = (cwd: string, args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' })

  it('prints the fingerprint alone on stdout', async () => {
    const root = folderWith({ ...server, ...buildFiles, Dockerfile: 'FROM node\n', 'dist/index.html': '<html>' })
    const result = run(root, ['dist', 'https://proxy.example.com/3'])
    expect(result).toMatchObject({ status: 0, stderr: '' })
    expect(result.stdout).toBe(`${(await main(['dist', 'https://proxy.example.com/3'], root)).out}\n`)
  })

  it('does nothing when imported', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(script).href)})`], {
      cwd: tmpdir(),
      encoding: 'utf8',
    })
    expect(result).toMatchObject({ status: 0, stdout: '', stderr: '' })
  })

  it('prints how to run it on stderr and fails without its arguments', () => {
    const result = run(tmpdir(), ['dist'])
    expect(result).toMatchObject({ status: 2, stdout: '', stderr: 'Usage: node scripts/edge/fingerprint.ts <dist> <proxy>\n' })
  })
})
