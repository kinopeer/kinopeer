// docker-compose.yml is the install beside Umbrel's (#358): what the README tells people to download.
// What ties its services together is checked here, read with a YAML parser as Compose reads it: the
// script that sets qBittorrent up on its first start, run in a shell, and the addresses, ports and
// mounts each service relies on in another. Starting it in Docker isn't: that needs the images and the
// network, so it's done by hand before a release (docs/RELEASE_CHECKLIST.md).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const ROOT = dirname(fileURLToPath(import.meta.url))

interface Service {
  image?: string
  build?: string
  entrypoint?: string[]
  environment?: Record<string, string>
  ports?: string[]
  volumes?: string[]
  networks?: string[] | Record<string, { ipv4_address?: string } | null>
}

interface Compose {
  services: Record<string, Service>
  networks?: Record<string, { ipam?: { config?: { subnet?: string; ip_range?: string }[] } }>
}

const readCompose = (file: string): Compose => parse(readFileSync(join(ROOT, file), 'utf8')) as Compose
const compose = readCompose('docker-compose.yml')
const service = (name: string): Service => {
  const found = compose.services[name]
  if (!found) throw new Error(`docker-compose.yml has no ${name} service`)
  return found
}

/** The script qBittorrent's entrypoint runs, after the image's own init. */
const seedScript = (): string => {
  const entrypoint = service('qbittorrent').entrypoint ?? []
  // The image's entrypoint is tini, then /entrypoint.sh, which the script runs last.
  expect(entrypoint.slice(0, 5)).toEqual(['/sbin/tini', '-g', '--', '/bin/sh', '-c'])
  expect(entrypoint).toHaveLength(6)
  return entrypoint[5] ?? ''
}

/** A qBittorrent.conf as `[Section] Key=value` pairs, keyed `Section/Key`. */
const readConf = (text: string): Record<string, string> => {
  const values: Record<string, string> = {}
  let section = ''
  for (const line of text.split('\n')) {
    const header = /^\[(.+)\]$/.exec(line)
    if (header) section = header[1] ?? ''
    else if (line.includes('=')) values[`${section}/${line.slice(0, line.indexOf('='))}`] = line.slice(line.indexOf('=') + 1)
  }
  return values
}

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

interface Start {
  /** A qBittorrent.conf already there. */
  existing?: string
  /** Who owns the downloads folder, as `stat -c %u:%g` says. */
  owner?: string
  /** The container's environment from Compose. */
  env?: Record<string, string>
}

/**
 * Runs the script as Compose hands it to the shell (`$$` turned into `$`), with /config moved into a
 * temporary folder and the image's entrypoint replaced by `env`, so what the script exports shows.
 * Returns the conf's path and the user the image would run qBittorrent as.
 */
const runSeed = ({ existing, owner = '1001:121', env = {} }: Start = {}): { conf: string; user: string } => {
  const folder = mkdtempSync(join(tmpdir(), 'kinopeer-seed-'))
  folders.push(folder)
  const conf = join(folder, 'qBittorrent/config/qBittorrent.conf')
  if (existing !== undefined) {
    execFileSync('mkdir', ['-p', dirname(conf)])
    writeFileSync(conf, existing)
  }
  // The image's busybox `stat`, answering only the call the script makes for the folder's owner
  // (macOS's own `stat` takes other options).
  const bin = join(folder, 'bin')
  execFileSync('mkdir', ['-p', bin])
  writeFileSync(join(bin, 'stat'), `#!/bin/sh\nif [ "$*" = "-c %u:%g /downloads" ]; then echo ${owner}; else exit 1; fi\n`, { mode: 0o755 })
  const script = seedScript().replaceAll('$$', '$')
  expect(script).toContain('/config/qBittorrent/config/qBittorrent.conf')
  expect(script.trimEnd().endsWith('exec /entrypoint.sh')).toBe(true)
  const shown = execFileSync('sh', ['-c', script.replaceAll('/config/qBittorrent/config', `${folder}/qBittorrent/config`).replace('exec /entrypoint.sh', 'exec env')], {
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, ...env },
    encoding: 'utf8',
  })
  const variable = (name: string) => shown.split('\n').find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1)
  return { conf, user: `${variable('PUID') ?? ''}:${variable('PGID') ?? ''}` }
}

/** The qBittorrent.conf the seed script writes on a first start, as `readConf` reads it. */
const seededConf = (): Record<string, string> => readConf(readFileSync(runSeed().conf, 'utf8'))

/** Compose's environment for qBittorrent with nothing in `.env`: `${PUID:-}` is empty. */
const composeEnv = (): Record<string, string> =>
  Object.fromEntries(Object.entries(service('qbittorrent').environment ?? {}).map(([name, value]) => [name, String(value).replace(/^\$\{\w+:-\}$/, '')]))

/** An IPv4 address as a number. */
const ipv4 = (address: string): number => address.split('.').reduce((value, part) => value * 256 + Number(part), 0)

/** Whether `address` is in the IPv4 range `cidr` (`172.30.97.0/24`). */
const inRange = (address: string, cidr: string): boolean => {
  const [base = '', bits = '32'] = cidr.split('/')
  const size = 2 ** (32 - Number(bits))
  const start = ipv4(base) - (ipv4(base) % size)
  return ipv4(address) >= start && ipv4(address) < start + size
}

/** A port mapping's port inside the container: `"6881:6881/udp"` → 6881. */
const containerPort = (mapping: string): number => Number(mapping.split('/')[0]?.split(':').at(-1))

const kinopeerAddress = (): string | undefined => {
  const networks = service('kinopeer').networks
  return Array.isArray(networks) ? undefined : networks?.kinopeer?.ipv4_address
}

describe("qBittorrent's first start", () => {
  it('writes the settings the image would, with Kinopeer’s address let in without a password', () => {
    expect(seededConf()).toEqual({
      'BitTorrent/Session\\DefaultSavePath': '/downloads',
      'BitTorrent/Session\\Port': '6881',
      'BitTorrent/Session\\TempPath': '/downloads/temp',
      'BitTorrent/Session\\TempPathEnabled': 'true',
      'Meta/MigrationVersion': '9999',
      'WebUI/Port': '8080',
      'WebUI/AuthSubnetWhitelistEnabled': 'true',
      'WebUI/AuthSubnetWhitelist': `${kinopeerAddress()}/32`,
    })
  })

  it('leaves settings that exist alone', () => {
    const { conf } = runSeed({ existing: '[WebUI]\nPassword_PBKDF2=x\n' })

    expect(readFileSync(conf, 'utf8')).toBe('[WebUI]\nPassword_PBKDF2=x\n')
  })

  it('writes every $ as $$, which Compose hands to the shell as $ rather than read as its variable', () => {
    expect(seedScript().replaceAll('$$', '')).not.toContain('$')
  })
})

describe('Who qBittorrent runs as', () => {
  it('is the downloads folder’s owner, with nothing in .env', () => {
    expect(composeEnv()).toMatchObject({ PUID: '', PGID: '' })
    expect(runSeed({ owner: '1001:121', env: composeEnv() }).user).toBe('1001:121')
  })

  it('is 1000:1000 rather than root, for a folder root owns', () => {
    // One Docker made itself because it was missing, or any folder on Docker Desktop.
    expect(runSeed({ owner: '0:0', env: composeEnv() }).user).toBe('1000:1000')
    expect(runSeed({ owner: '0:121', env: composeEnv() }).user).toBe('1000:1000')
  })

  it('is PUID and PGID when .env sets them', () => {
    expect(runSeed({ owner: '1001:121', env: { ...composeEnv(), PUID: '1234', PGID: '99' } }).user).toBe('1234:99')
  })
})

describe('Kinopeer’s place on the network', () => {
  const range = compose.networks?.kinopeer?.ipam?.config?.[0] ?? {}

  it('is a fixed address in the network’s fixed range', () => {
    const address = kinopeerAddress() ?? ''

    expect(range.subnet).toMatch(/^\d+\.\d+\.\d+\.0\/24$/)
    expect(inRange(address, range.subnet ?? '')).toBe(true)
    // Not the range's own address, Docker's gateway (its first) or its broadcast address.
    expect(address).not.toMatch(/\.(0|1|255)$/)
  })

  it('is outside the range Docker gives the other containers their addresses from', () => {
    // Otherwise a recreated container could take it, Kinopeer wouldn't start, and that container
    // would get into qBittorrent without a password.
    const address = kinopeerAddress() ?? ''

    expect(range.ip_range).toMatch(/^\d+\.\d+\.\d+\.\d+\/\d+$/)
    expect(inRange(range.ip_range?.split('/')[0] ?? '', range.subnet ?? '')).toBe(true)
    expect(inRange(address, range.ip_range ?? '')).toBe(false)
  })

  it('is the network the other services are on', () => {
    expect(service('qbittorrent').networks).toEqual(['kinopeer'])
    expect(service('prowlarr').networks).toEqual(['kinopeer'])
  })
})

describe('Kinopeer’s environment', () => {
  const environment = service('kinopeer').environment ?? {}

  it('names qBittorrent at the port its first start sets', () => {
    expect(environment.QBITTORRENT_URL).toBe(`http://qbittorrent:${seededConf()['WebUI/Port']}`)
  })

  it('names Prowlarr at the port its image listens at', () => {
    const published = (service('prowlarr').ports ?? []).map(containerPort)

    expect(environment.PROWLARR_URL).toBe('http://prowlarr:9696')
    expect(published).toEqual([9696])
  })

  it('reads Prowlarr’s key from its config folder, mounted read-only', () => {
    const configVolume = (service('prowlarr').volumes ?? []).find((volume) => volume.endsWith(':/config'))?.split(':')[0]

    expect(environment.PROWLARR_CONFIG_XML).toBe('/prowlarr/config.xml')
    expect(service('kinopeer').volumes).toContain(`${configVolume}:/prowlarr:ro`)
  })
})

describe("qBittorrent's ports", () => {
  it('publish the peers’ port, not the web UI, which lets Kinopeer’s address in without a password', () => {
    expect((service('qbittorrent').ports ?? []).map(containerPort)).toEqual([6881, 6881])
    expect(seededConf()['BitTorrent/Session\\Port']).toBe('6881')
  })
})

interface Step {
  name?: string
  uses?: string
  run?: string
  with?: Record<string, unknown>
}

/** The release workflow's step that `match` picks, read with the YAML parser. */
const releaseStep = (match: (step: Step) => boolean): Step => {
  const workflow = parse(readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8')) as { jobs: Record<string, { steps?: Step[] }> }
  const step = Object.values(workflow.jobs)
    .flatMap((job) => job.steps ?? [])
    .find(match)
  if (!step) throw new Error('release.yml has no such step')
  return step
}

describe("Kinopeer's image", () => {
  it('is the newest release of the version’s major, which the release workflow tags', () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
    const tags = String(releaseStep((step) => step.uses?.startsWith('docker/metadata-action@') ?? false).with?.tags ?? '')

    expect(service('kinopeer').image).toBe(`ghcr.io/kinopeer/kinopeer:${version.split('.')[0]}`)
    // The metadata action's tags, one per line.
    expect(tags.split('\n').map((line) => line.trim())).toContain('type=semver,pattern={{major}}')
  })

  it('comes with the file, attached to each GitHub Release, which the README downloads', () => {
    const run = releaseStep((step) => step.name === 'Create the GitHub Release').run ?? ''
    // The shell command's words: the files after the options are the release's assets.
    const create = run.split('\n').find((line) => line.trim().startsWith('gh release create')) ?? ''

    expect(create.trim().split(/\s+/)).toContain('docker-compose.yml')
  })

  it('is built from the checkout with docker-compose.build.yml', () => {
    expect(readCompose('docker-compose.build.yml').services.kinopeer).toEqual({ build: '.', image: 'kinopeer:local' })
  })
})

describe('The downloads folder, by default in the checkout when the build is checked', () => {
  // `${DOWNLOADS_DIR:-./downloads}`: the folder qBittorrent downloads into, by default.
  const folder = (service('qbittorrent').volumes ?? []).find((volume) => volume.endsWith(':/downloads'))?.match(/:-\.\/([^}]+)\}/)?.[1]

  it('stays out of the image’s build context', () => {
    const ignored = readFileSync(join(ROOT, '.dockerignore'), 'utf8').split('\n').map((line) => line.trim())

    expect(folder).toBe('downloads')
    expect(ignored).toContain(folder)
  })

  it('stays out of Stryker’s sandbox', async () => {
    // By its URL, since the config is plain JavaScript without types.
    const { default: stryker } = (await import(pathToFileURL(join(ROOT, 'stryker.config.mjs')).href)) as { default: { ignorePatterns: string[] } }

    expect(stryker.ignorePatterns).toContain(`/${folder}`)
  })
})
