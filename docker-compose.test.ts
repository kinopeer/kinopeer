// docker-compose.yml is the install beside Umbrel's (#358): what the README tells people to download.
// What ties its services together is checked here, read with a YAML parser as Compose reads it: the
// script that sets qBittorrent up on its first start, run in a shell, and the addresses, ports and
// mounts each service relies on in another. Starting it in Docker isn't: that needs the images and the
// network, so it's done by hand before a release (docs/RELEASE_CHECKLIST.md).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  networks?: Record<string, { ipam?: { config?: { subnet?: string }[] } }>
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

/**
 * Runs the seed script with /config moved into a temporary folder and the image's entrypoint left out,
 * and returns that folder's qBittorrent.conf path. `existing` is a conf already there.
 */
const runSeed = (existing?: string): string => {
  const folder = mkdtempSync(join(tmpdir(), 'kinopeer-seed-'))
  folders.push(folder)
  const conf = join(folder, 'qBittorrent/config/qBittorrent.conf')
  if (existing !== undefined) {
    execFileSync('mkdir', ['-p', dirname(conf)])
    writeFileSync(conf, existing)
  }
  const script = seedScript()
  expect(script).toContain('/config/qBittorrent/config/qBittorrent.conf')
  expect(script.trimEnd().endsWith('exec /entrypoint.sh')).toBe(true)
  execFileSync('sh', ['-c', script.replaceAll('/config/qBittorrent/config', `${folder}/qBittorrent/config`).replace('exec /entrypoint.sh', 'exec true')])
  return conf
}

/** A port mapping's port inside the container: `"6881:6881/udp"` → 6881. */
const containerPort = (mapping: string): number => Number(mapping.split('/')[0]?.split(':').at(-1))

const kinopeerAddress = (): string | undefined => {
  const networks = service('kinopeer').networks
  return Array.isArray(networks) ? undefined : networks?.kinopeer?.ipv4_address
}

describe("qBittorrent's first start", () => {
  it('writes the settings the image would, with Kinopeer’s address let in without a password', () => {
    const conf = readConf(readFileSync(runSeed(), 'utf8'))

    expect(conf).toEqual({
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
    const conf = runSeed('[WebUI]\nPassword_PBKDF2=x\n')

    expect(readFileSync(conf, 'utf8')).toBe('[WebUI]\nPassword_PBKDF2=x\n')
  })

  it('has no $, which Compose would read as a variable', () => {
    expect(seedScript()).not.toContain('$')
  })
})

describe('Kinopeer’s place on the network', () => {
  it('is a fixed address in the network’s fixed range', () => {
    const subnet = compose.networks?.kinopeer?.ipam?.config?.[0]?.subnet ?? ''
    const address = kinopeerAddress() ?? ''

    expect(subnet).toMatch(/^\d+\.\d+\.\d+\.0\/24$/)
    expect(address.split('.').slice(0, 3)).toEqual(subnet.split('.').slice(0, 3))
    expect(address).not.toMatch(/\.(0|1|255)$/)
  })

  it('is the network the other services are on', () => {
    expect(service('qbittorrent').networks).toEqual(['kinopeer'])
    expect(service('prowlarr').networks).toEqual(['kinopeer'])
  })
})

describe('Kinopeer’s environment', () => {
  const environment = service('kinopeer').environment ?? {}

  it('names qBittorrent at the port its first start sets', () => {
    const conf = readConf(readFileSync(runSeed(), 'utf8'))

    expect(environment.QBITTORRENT_URL).toBe(`http://qbittorrent:${conf['WebUI/Port']}`)
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
    const conf = readConf(readFileSync(runSeed(), 'utf8'))

    expect((service('qbittorrent').ports ?? []).map(containerPort)).toEqual([6881, 6881])
    expect(conf['BitTorrent/Session\\Port']).toBe('6881')
  })
})

describe("Kinopeer's image", () => {
  it('is the newest release of the version’s major, which the release workflow tags', () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
    const release = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8')

    expect(service('kinopeer').image).toBe(`ghcr.io/kinopeer/kinopeer:${version.split('.')[0]}`)
    // The metadata action's tags, one per line.
    const tags = release.split('\n').map((line) => line.trim())
    expect(tags).toContain('type=semver,pattern={{major}}')
  })

  it('is built from the checkout with docker-compose.build.yml', () => {
    expect(readCompose('docker-compose.build.yml').services.kinopeer).toEqual({ build: '.', image: 'kinopeer:local' })
  })
})
