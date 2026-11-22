import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { getAppVersion, getMainData, stopTorrents } from './client'
import { QbittorrentError, UnauthorizedError, unreachable } from './errors'
import { webuiTransport } from './transport'

let fetchMock: Mock<typeof fetch>

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!
  return { url: String(url), init: init! }
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

describe('webuiTransport', () => {
  it("calls qBittorrent's API on the page's origin, relative to the page, with qBittorrent's own cookie and nothing of the bridge's", async () => {
    fetchMock.mockResolvedValueOnce(new Response('v5.3.0'))
    const response = await webuiTransport('/app/version', { method: 'GET' })

    expect(await response.text()).toBe('v5.3.0')
    expect(lastCall().url).toBe('api/v2/app/version')
    expect(lastCall().init).toMatchObject({ method: 'GET', credentials: 'same-origin' })
    expect(lastCall().init.headers).toBeUndefined()
  })

  it('takes a 403 for a session that ended or never began', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
    const error = await webuiTransport('/sync/maindata', { method: 'GET' }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(UnauthorizedError)
    expect((error as UnauthorizedError).source).toBeUndefined()
  })

  it("throws any other refusal with qBittorrent's status, without the bridge's mark it never has", async () => {
    fetchMock.mockResolvedValueOnce(new Response('Conflict', { status: 409 }))
    const error = await webuiTransport('/torrents/setCategory', { method: 'POST', body: new URLSearchParams() }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(QbittorrentError)
    expect(error).not.toBeInstanceOf(UnauthorizedError)
    expect(error).toMatchObject({ status: 409 })
    expect(unreachable(error)).toBe('qbittorrent')
  })
})

describe('the client in each build', () => {
  it('goes straight to qBittorrent in the WebUI build, a GET with its query and a POST with its form', async () => {
    vi.stubGlobal('__WEBUI__', true)
    fetchMock.mockResolvedValueOnce(Response.json({ rid: 3 }))
    await expect(getMainData(2)).resolves.toEqual({ rid: 3 })
    expect(lastCall().url).toBe('api/v2/sync/maindata?rid=2')

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))
    await stopTorrents(['a1', 'b2'])
    expect(lastCall().url).toBe('api/v2/torrents/stop')
    expect(lastCall().init).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(String(lastCall().init.body)).toBe('hashes=a1%7Cb2')
  })

  it('names qBittorrent as the one that didn’t answer in the WebUI build, which has no Kinopeer server', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const error = await getAppVersion().catch((caught: unknown) => caught)
    expect(unreachable(error)).toBe('unreached')
    vi.stubGlobal('__WEBUI__', true)
    expect(unreachable(error)).toBe('qbittorrent')
  })
})
