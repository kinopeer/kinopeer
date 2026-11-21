import { afterEach, describe, expect, it } from 'vitest'
import { setUpPassword } from '../../src/api/auth/index.ts'
import { UnauthorizedError, getAppVersion } from '../../src/api/qbittorrent/client.ts'
import { saveProwlarrKey, saveQbittorrentLogin } from '../../src/api/settings/client.ts'
import type { ContainerSystem } from '../container.ts'
import { CLOSED_ADDRESS } from '../test/fakes.ts'
import { startKinopeer, stopKinopeer } from '../test/integration.ts'

afterEach(async () => {
  await stopKinopeer()
})

/**
 * A container on a Docker network, 172.18.0.0/16: Docker Desktop's `host.docker.internal`, and
 * `localhost`, which the fake qBittorrent listens on, standing for a service at 172.18.0.3.
 */
const SYSTEM: ContainerSystem = {
  exists: (path) => path === '/.dockerenv',
  readFile: () => undefined,
  resolve: async (host) => ({ 'host.docker.internal': '192.168.65.254', localhost: '172.18.0.3' })[host],
  localAddressTo: async () => '172.18.0.5',
  interfaces: () => ({
    eth0: [{ address: '172.18.0.5', netmask: '255.255.0.0', family: 'IPv4', mac: '02:42:ac:12:00:05', internal: false, cidr: '172.18.0.5/16' }],
  }),
}

describe('the hints for Kinopeer in a container, through the real server (#509)', () => {
  it('offers the host’s address for a form’s address on localhost that doesn’t answer', async () => {
    // Beyond Umbrel: the login on, and no address in the environment, so the forms send one.
    await startKinopeer({ env: { KINOPEER_AUTH: undefined, QBITTORRENT_URL: undefined, PROWLARR_URL: undefined }, container: SYSTEM })
    await setUpPassword('correct horse')
    const hostAddress = CLOSED_ADDRESS.replace('127.0.0.1', 'host.docker.internal')
    await expect(saveQbittorrentLogin('admin', 'x', CLOSED_ADDRESS)).rejects.toMatchObject({ status: 502, code: 'unreachable', container: { hostAddress } })
    await expect(saveProwlarrKey('a-key', CLOSED_ADDRESS)).rejects.toMatchObject({ status: 502, code: 'unreachable', container: { hostAddress } })
  })

  it('says where qBittorrent sees Kinopeer when it asks for a login the server has none for', async () => {
    const { qbittorrent, stores } = await startKinopeer({
      env: { QBITTORRENT_URL: undefined, QBITTORRENT_USERNAME: undefined, QBITTORRENT_PASSWORD: undefined },
      container: SYSTEM,
    })
    // The address as saved from the app, by a name the container's system resolves.
    await stores.settings.update({ qbittorrentUrl: qbittorrent.base.replace('127.0.0.1', 'localhost') })
    const error = await getAppVersion().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(UnauthorizedError)
    expect((error as UnauthorizedError).source).toEqual({ address: '172.18.0.5', subnet: '172.18.0.0/16' })
  })
})
