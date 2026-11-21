// @vitest-environment jsdom
// unraid/kinopeer.xml is what Unraid's Community Applications installs (#512). What it hands the
// image is checked here, read with an XML parser as CA reads it: the image's tag, port and volume,
// that each variable is one the server reads, and that the empty ones Unraid still passes (`-e NAME=''`,
// dockerMan's xmlToCommand) read as unset. Installing it on Unraid isn't: that's done by hand in an
// Unraid VM whenever the template changes (docs/RELEASE_CHECKLIST.md). jsdom gives the XML parser,
// DOMParser.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { allowedHostsWarning } from '../server/hostCheck.ts'
import { ignoredSettings, missingSettings } from '../server/main.ts'
import { SettingsStore } from '../server/settings.ts'

// tsconfig.node.json, which types this file with the server's, has no DOM: the few members read here.
interface XmlElement {
  tagName: string
  textContent: string | null
  getAttribute(name: string): string | null
}
interface XmlDocument {
  documentElement: XmlElement
  querySelector(selectors: string): XmlElement | null
  querySelectorAll(selectors: string): Iterable<XmlElement>
  getElementsByTagName(name: string): { length: number }
}
const { DOMParser } = globalThis as unknown as { DOMParser: new () => { parseFromString(text: string, type: 'text/xml'): XmlDocument } }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')
const xml = (file: string): XmlDocument => {
  const document = new DOMParser().parseFromString(read(file), 'text/xml')
  expect(document.getElementsByTagName('parsererror')).toHaveLength(0)
  return document
}

const template = xml('unraid/kinopeer.xml')
const text = (tag: string): string => template.querySelector(`Container > ${tag}`)?.textContent?.trim() ?? ''

interface Config {
  name: string
  target: string
  default: string
  mode: string
  type: string
  required: boolean
}
const configs: Config[] = [...template.querySelectorAll('Container > Config')].map((config) => ({
  name: config.getAttribute('Name') ?? '',
  target: config.getAttribute('Target') ?? '',
  default: config.getAttribute('Default') ?? '',
  mode: config.getAttribute('Mode') ?? '',
  type: config.getAttribute('Type') ?? '',
  required: config.getAttribute('Required') === 'true',
}))
const ofType = (type: string) => configs.filter((config) => config.type === type)
const byTarget = (target: string): Config => {
  const found = configs.find((config) => config.target === target)
  if (!found) throw new Error(`unraid/kinopeer.xml has no Config for ${target}`)
  return found
}

/** The environment Unraid starts the container with: every variable, an empty one as ''. */
const environment = Object.fromEntries(ofType('Variable').map((config) => [config.target, config.default]))

const compose = parse(read('docker-compose.yml')) as { services: { kinopeer: { image: string; ports: string[] } } }

describe("The template's image", () => {
  it('is the tag docker-compose.yml installs, the newest release of the version’s major', () => {
    const { version } = JSON.parse(read('package.json')) as { version: string }
    expect(text('Repository')).toBe(`ghcr.io/kinopeer/kinopeer:${version.split('.')[0]}`)
    expect(text('Repository')).toBe(compose.services.kinopeer.image)
  })

  it('runs as Unraid’s nobody:users, who own the appdata folder dockerMan creates', () => {
    expect(text('ExtraParams').split(/\s+/)).toEqual(['--user', '99:100'])
    expect(byTarget('/data').default.startsWith('/mnt/user/appdata/')).toBe(true)
  })
})

describe("The template's port and folders", () => {
  it('maps the port the image listens at to the one docker-compose.yml opens it at, which the Web UI link names', () => {
    const exposed = /^EXPOSE (\d+)$/m.exec(read('Dockerfile'))?.[1]
    const ports = ofType('Port')
    expect(ports.map((port) => port.target)).toEqual([exposed])
    expect(`${ports[0]?.default}:${ports[0]?.target}`).toBe(compose.services.kinopeer.ports[0]?.replace('${KINOPEER_PORT:-8797}', '8797'))
    expect(text('WebUI')).toBe(`http://[IP]:[PORT:${exposed}]/`)
  })

  it('keeps the image’s data volume in a folder of its own, required', () => {
    const volume = /^VOLUME (\S+)$/m.exec(read('Dockerfile'))?.[1]
    expect(byTarget(volume ?? '')).toMatchObject({ type: 'Path', default: '/mnt/user/appdata/kinopeer', mode: 'rw', required: true })
  })

  it('mounts Prowlarr’s config folder read-only where the file variable points, both empty by default', () => {
    const folder = byTarget('/prowlarr')
    expect(folder).toMatchObject({ type: 'Path', mode: 'ro', default: '', required: false })
    const file = byTarget('PROWLARR_CONFIG_XML')
    expect(file.default).toBe('')
    expect(template.querySelector('Config[Target="PROWLARR_CONFIG_XML"]')?.getAttribute('Description')).toContain(`${folder.target}/config.xml`)
  })
})

describe("The template's variables", () => {
  const dirs: string[] = []
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  it('are each one the server reads', () => {
    const sources = readdirSync(join(ROOT, 'server'), { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.startsWith('test'))
      .map((file) => readFileSync(join(ROOT, 'server', file), 'utf8'))
      .join('\n')
    for (const name of Object.keys(environment)) expect(sources, name).toMatch(new RegExp(`\\benv\\.${name}\\b`))
  })

  it('read as unset while empty, as Unraid passes them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kinopeer-unraid-'))
    dirs.push(dir)
    const settings = new SettingsStore(dir)
    expect(Object.values(environment).every((value) => value === '' || value === undefined)).toBe(true)
    expect(missingSettings(environment, settings)).toEqual(missingSettings({}, settings))
    expect(ignoredSettings(environment)).toEqual([])
    expect(allowedHostsWarning(environment.KINOPEER_ALLOWED_HOSTS)).toBeUndefined()
  })

  it('hide the password Unraid shows in its form', () => {
    expect(template.querySelector('Config[Target="KINOPEER_PASSWORD"]')?.getAttribute('Mask')).toBe('true')
  })
})

describe('What Community Applications reads', () => {
  it('finds the template at its TemplateURL and the icon at its address, both on main', () => {
    const raw = 'https://raw.githubusercontent.com/kinopeer/kinopeer/main/'
    expect(text('TemplateURL')).toBe(`${raw}unraid/kinopeer.xml`)
    for (const address of [text('Icon'), xml('ca_profile.xml').querySelector('Icon')?.textContent ?? '']) {
      expect(address.startsWith(raw)).toBe(true)
      expect(existsSync(join(ROOT, address.slice(raw.length)))).toBe(true)
    }
  })

  it('has the repository’s profile at its root, its Profile not empty', () => {
    const profile = xml('ca_profile.xml')
    expect(profile.documentElement.tagName).toBe('CommunityApplications')
    expect(profile.querySelector('CommunityApplications > Profile')?.textContent?.trim()).not.toBe('')
  })

  it('finds no other XML in the repository, since CA’s docs don’t say which files it reads as templates', () => {
    const tracked = execFileSync('git', ['ls-files', '*.xml'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
    expect(tracked.sort()).toEqual(['ca_profile.xml', 'unraid/kinopeer.xml'])
  })
})
