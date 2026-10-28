import { afterEach, describe, expect, it } from 'vitest'
import { ProwlarrError, ProwlarrSetupError, fetchRelease, getFailingIndexers, getProwlarrStatus, searchReleases } from '../../src/api/prowlarr/client.ts'
import { TV_CATEGORY, type Release } from '../../src/api/prowlarr/types.ts'
import { RELEASES, shogunTorrent } from '../../src/test/fixtures.ts'
import { PROWLARR_MAGNET } from '../test/fakes.ts'
import { startKinoseed, stopKinoseed } from '../test/integration.ts'

afterEach(stopKinoseed)

/** A fixture release as the server hands it to the browser: its download link as a token without the key. */
const fromServer = ({ download, ...release }: Release): Release => ({
  ...release,
  ...(download ? { download: `1/download?link=${download}` } : {}),
})

/** The Shōgun release with a .torrent and a magnet link; `link` replaces the .torrent's. */
const shogun = (link = 'shogun'): Release => ({ ...fromServer(RELEASES[0]), download: `1/download?link=${link}`, magnet: PROWLARR_MAGNET })

describe('Prowlarr client through /prowlarr', () => {
  it('searches through the server, which adds the key and keeps it out of the results', async () => {
    const { prowlarr, responses } = await startKinoseed()
    const releases = await searchReleases('Shogun', { type: 'tvsearch', categories: [TV_CATEGORY] })

    expect(releases).toEqual(RELEASES.map(fromServer))
    expect(prowlarr.seen).toEqual([{ url: '/api/v1/search?query=Shogun&type=tvsearch&limit=100&categories=5000', key: prowlarr.apiKey }])
    expect(await responses[0].text()).not.toContain(prowlarr.apiKey)
  })

  it('tells setup problems from other failures', async () => {
    await startKinoseed({ env: { PROWLARR_URL: undefined } })
    await expect(searchReleases('a')).rejects.toBeInstanceOf(ProwlarrSetupError)
    await expect(searchReleases('a')).rejects.toMatchObject({ status: 503, code: 'not-configured' })

    const { prowlarr } = await startKinoseed({ env: { PROWLARR_API_KEY: 'wrong-key' } })
    await expect(searchReleases('a')).rejects.toMatchObject({ status: 502, code: 'unauthorized' })
    expect(prowlarr.seen.at(-1)).toMatchObject({ key: 'wrong-key' })

    await startKinoseed({ env: { PROWLARR_URL: 'http://127.0.0.1:9' } })
    const down = await searchReleases('a').catch((error: unknown) => error)
    expect(down).toBeInstanceOf(ProwlarrError)
    expect(down).not.toBeInstanceOf(ProwlarrSetupError)
    expect(down).toMatchObject({ status: 502, code: 'unreachable' })
  })

  it('downloads the .torrent with the key put back, and falls back to the magnet link', async () => {
    const { prowlarr, responses } = await startKinoseed()
    const source = await fetchRelease(shogun())
    expect(source.kind).toBe('torrent')
    const file = (source as { file: File }).file
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(shogunTorrent())
    expect(prowlarr.seen).toEqual([{ url: `/api/v1/indexer/1/download?link=shogun&apikey=${prowlarr.apiKey}`, key: prowlarr.apiKey }])
    expect(await responses[0].text()).not.toContain(prowlarr.apiKey)

    await expect(fetchRelease(shogun('missing'))).resolves.toEqual({ kind: 'magnet', uri: PROWLARR_MAGNET })
    expect(prowlarr.seen.at(-1)?.url).toContain('link=missing')
  })

  it('returns the magnet link Prowlarr redirected to', async () => {
    await startKinoseed()
    await expect(fetchRelease({ ...shogun('magnet'), magnet: undefined })).resolves.toEqual({ kind: 'magnet', uri: PROWLARR_MAGNET })
  })

  it('reports the version and the enabled indexers, or a setup error', async () => {
    const { prowlarr } = await startKinoseed()
    await expect(getProwlarrStatus()).resolves.toEqual({ version: '1.24.3.4754', indexers: 2 })
    expect(prowlarr.seen.map((request) => request.url).sort()).toEqual(['/api/v1/indexer', '/api/v1/system/status'])

    await startKinoseed({ env: { PROWLARR_API_KEY: 'wrong-key' } })
    await expect(getProwlarrStatus()).rejects.toBeInstanceOf(ProwlarrSetupError)
  })

  it('names the indexers that failed during a search, from the server and Prowlarr together', async () => {
    const recently = new Date(Date.now() - 1_000).toISOString()
    const { prowlarr } = await startKinoseed({
      prowlarr: {
        indexerStatus: [
          { indexerId: 2, mostRecentFailure: recently },
          // Disabled in Prowlarr: not one the search asked.
          { indexerId: 3, mostRecentFailure: recently },
        ],
      },
    })
    await expect(getFailingIndexers(60_000)).resolves.toEqual(['NNM-Club'])
    expect(prowlarr.seen.map((request) => request.url).sort()).toEqual(['/api/v1/indexer', '/api/v1/indexerstatus'])
  })

  it('passes a rejected key on the failing-indexers check to the client as a server error', async () => {
    await startKinoseed({ env: { PROWLARR_API_KEY: 'wrong-key' } })
    await expect(getFailingIndexers(0)).rejects.toMatchObject({ status: 502, code: 'unauthorized' })
  })
})
