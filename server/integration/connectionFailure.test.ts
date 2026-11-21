import { createServer as createTcpServer, type AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConnectionFailure } from '../../src/api/connectionFailure.ts'
import { getProwlarrStatus } from '../../src/api/prowlarr/client.ts'
import { getAppVersion } from '../../src/api/qbittorrent/client.ts'
import { saveProwlarrKey, saveQbittorrentLogin } from '../../src/api/settings/client.ts'
import { CLOSED_ADDRESS, listen } from '../test/fakes.ts'
import { startKinopeer, stopKinopeer } from '../test/integration.ts'

const sockets: { close: () => void }[] = []

afterEach(async () => {
  await stopKinopeer()
  for (const socket of sockets.splice(0)) socket.close()
})

/** A port that takes a connection and closes it at once, without a byte. */
async function closingAddress(): Promise<string> {
  const server = createTcpServer((socket) => socket.destroy())
  sockets.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('why qBittorrent or Prowlarr didn’t answer, from a real socket through the clients (#508)', () => {
  it.each<[string, ConnectionFailure, () => Promise<string>]>([
    ['nothing listens on the port', 'refused', async () => CLOSED_ADDRESS],
    // .invalid never resolves (RFC 2606).
    ['the name doesn’t resolve', 'name', async () => 'http://kinopeer-test.invalid:8080'],
    ['https on a port that answers in plain HTTP', 'http', async () => (await listen((_request, response) => response.end('ok'))).replace('http:', 'https:')],
    ['the connection closes without an answer', 'closed', closingAddress],
  ])('%s: %s', async (_, failure, address) => {
    await startKinopeer({ env: { QBITTORRENT_URL: await address(), PROWLARR_URL: await address() } })
    // The checks a person runs while setting up.
    await expect(saveQbittorrentLogin('admin', 'x')).rejects.toMatchObject({ status: 502, code: 'unreachable', failure })
    await expect(saveProwlarrKey('a-key')).rejects.toMatchObject({ status: 502, code: 'unreachable', failure })
    // The bridges, which Settings' checks and the session check go through.
    await expect(getAppVersion()).rejects.toMatchObject({ status: 502, failure })
    await expect(getProwlarrStatus()).rejects.toMatchObject({ status: 502, code: 'unreachable', failure })
  })
})
