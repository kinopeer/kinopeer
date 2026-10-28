import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { downloadToken, failingIndexers, prowlarrMiddleware, readProwlarrApiKey, type ProwlarrConfig } from './prowlarr.ts'
import { closeServers, listen, serve } from './test/fakes.ts'

const KEY = 'secret-key-123'

/** Kinoseed's side: the middleware under test. */
const kinoseed = (config: ProwlarrConfig) => serve(prowlarrMiddleware(config))

afterEach(closeServers)

describe('downloadToken', () => {
  it('keeps the indexer and link but drops the API key', () => {
    expect(downloadToken(`http://prowlarr:9696/12/download?apikey=${KEY}&link=abc%3D&file=Dune`)).toBe(
      '12/download?link=abc%3D&file=Dune',
    )
    expect(downloadToken('http://prowlarr:9696/api/v1/indexer')).toBeUndefined()
    expect(downloadToken('not a url')).toBeUndefined()
  })
})

describe('failingIndexers', () => {
  const now = Date.parse('2026-10-28T01:00:00Z')
  const since = Date.parse('2026-10-28T00:59:00Z')
  const indexers = [
    { id: 1, name: 'RuTracker', enable: true },
    { id: 2, name: 'Kinozal', enable: true },
    { id: 3, name: 'Old', enable: false },
    { id: 4, name: 'Fine', enable: true },
    { id: 5, name: 'Earlier', enable: true },
  ]

  it('names enabled indexers that failed during the search or are on hold, sorted', () => {
    const statuses = [
      { indexerId: 1, mostRecentFailure: '2026-10-28T00:59:30Z' },
      { indexerId: 2, disabledTill: '2026-10-28T02:00:00Z', mostRecentFailure: '2026-10-27T20:00:00Z' },
      { indexerId: 3, disabledTill: '2026-10-28T02:00:00Z' },
      { indexerId: 4, disabledTill: '2026-10-28T00:30:00Z' },
      // Failed before this search and isn't on hold: an older failure, not this search's.
      { indexerId: 5, mostRecentFailure: '2026-10-28T00:58:59Z' },
    ]
    expect(failingIndexers(indexers, statuses, since, now)).toEqual(['Kinozal', 'RuTracker'])
  })

  it('names none when nothing failed', () => {
    expect(failingIndexers(indexers, [], since, now)).toEqual([])
  })

  it('never counts a row without an id as a failure', () => {
    const statuses = [{ mostRecentFailure: '2026-10-28T00:59:30Z' }]
    expect(failingIndexers([...indexers, { name: 'No id', enable: true }], statuses, since, now)).toEqual([])
  })
})

describe('prowlarrMiddleware', () => {
  it('passes other paths on and reports a missing configuration', async () => {
    const base = await kinoseed({})
    expect((await fetch(`${base}/qbt/api/v2/app/version`)).status).toBe(404)
    const response = await fetch(`${base}/prowlarr/search?query=dune`)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'not-configured' })
  })

  it('searches with the key and strips it from the results', async () => {
    let seen: { url?: string; key?: string } = {}
    const prowlarr = await listen((request, response) => {
      seen = { url: request.url, key: request.headers['x-api-key'] as string }
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify([
          {
            guid: 'kinozal-1',
            title: 'Дюна / Dune (2021) BDRip 1080p',
            indexer: 'Kinozal',
            size: 12_000_000_000,
            seeders: 42,
            leechers: 3,
            categories: [{ id: 2000 }, { id: 100_001 }],
            protocol: 'torrent',
            downloadUrl: `http://somewhere:9696/1/download?apikey=${KEY}&link=AAA&file=Dune`,
            infoUrl: 'https://kinozal.me/details.php?id=1',
            tmdbId: 438631,
          },
          { guid: 'magnet-1', title: 'Dune 2021', protocol: 'torrent', magnetUrl: 'magnet:?xt=urn:btih:abc' },
          { guid: 'nzb-1', title: 'Dune NZB', protocol: 'usenet', downloadUrl: 'http://x/1/download?link=b' },
          { guid: 'nolink', title: 'No link', protocol: 'torrent' },
        ]),
      )
    })
    const base = await kinoseed({ url: `${prowlarr}/`, apiKey: KEY })

    const response = await fetch(`${base}/prowlarr/search?query=Dune&type=movie&categories=2000`)
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(text).not.toContain(KEY)
    expect(seen).toEqual({ url: '/api/v1/search?query=Dune&type=movie&limit=100&categories=2000', key: KEY })
    expect(JSON.parse(text)).toEqual([
      expect.objectContaining({
        id: 'kinozal-1',
        seeders: 42,
        categories: [2000, 100_001],
        download: '1/download?link=AAA&file=Dune',
        tmdbId: 438631,
      }),
      expect.objectContaining({ id: 'magnet-1', magnet: 'magnet:?xt=urn:btih:abc' }),
    ])
  })

  it('reports the version and enabled indexers', async () => {
    const seen: (string | undefined)[] = []
    const prowlarr = await listen((request, response) => {
      seen.push(request.headers['x-api-key'] as string | undefined)
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/api/v1/system/status') return response.end(JSON.stringify({ version: '1.24.3' }))
      if (request.url === '/api/v1/indexer') {
        return response.end(JSON.stringify([{ enable: true }, { enable: false }, { enable: true }]))
      }
      response.statusCode = 404
      response.end()
    })
    const response = await fetch(`${await kinoseed({ url: prowlarr, apiKey: KEY })}/prowlarr/status`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ version: '1.24.3', indexers: 2 })
    expect(seen).toEqual([KEY, KEY])
  })

  it('reads the key on every request when it is a function', async () => {
    const seen: (string | undefined)[] = []
    const prowlarr = await listen((request, response) => {
      seen.push(request.headers['x-api-key'] as string | undefined)
      response.setHeader('Content-Type', 'application/json')
      response.end(request.url === '/api/v1/indexer' ? '[]' : '{"version":"2.6.5"}')
    })
    let key: string | undefined
    const base = await kinoseed({ url: prowlarr, apiKey: async () => key })
    expect((await fetch(`${base}/prowlarr/status`)).status).toBe(503)
    key = KEY
    expect((await fetch(`${base}/prowlarr/status`)).status).toBe(200)
    expect(seen).toEqual([KEY, KEY])
  })

  it('reports a rejected key on the status check', async () => {
    const prowlarr = await listen((_request, response) => {
      response.statusCode = 401
      response.end()
    })
    const response = await fetch(`${await kinoseed({ url: prowlarr, apiKey: KEY })}/prowlarr/status`)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
  })

  it('rejects bad search parameters', async () => {
    const base = await kinoseed({ url: 'http://127.0.0.1:9', apiKey: KEY })
    expect((await fetch(`${base}/prowlarr/search?query=%20`)).status).toBe(400)
    expect((await fetch(`${base}/prowlarr/search?query=a&type=music`)).status).toBe(400)
    expect((await fetch(`${base}/prowlarr/search?query=a&categories=x`)).status).toBe(400)
  })

  it('reports a rejected key and an unreachable Prowlarr without leaking the key', async () => {
    const prowlarr = await listen((_request, response) => {
      response.statusCode = 401
      response.end()
    })
    const rejected = await fetch(`${(await kinoseed({ url: prowlarr, apiKey: KEY }))}/prowlarr/search?query=a`)
    expect(rejected.status).toBe(502)
    expect(await rejected.json()).toEqual({ error: 'unauthorized' })

    const down = await fetch(`${(await kinoseed({ url: 'http://127.0.0.1:9', apiKey: KEY }))}/prowlarr/search?query=a`)
    expect(down.status).toBe(502)
    expect(await down.text()).toBe('{"error":"unreachable"}')
  })

  it('asks Prowlarr which indexers failed since the search started, by its own clock', async () => {
    const seen: { path: string; key?: string }[] = []
    const prowlarr = await listen((request, response) => {
      seen.push({ path: request.url!, key: request.headers['x-api-key'] as string })
      response.setHeader('Content-Type', 'application/json')
      const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
      response.end(
        JSON.stringify(
          request.url === '/api/v1/indexer'
            ? [{ id: 1, name: 'RuTracker', enable: true }, { id: 2, name: 'Kinozal', enable: true }]
            : [
                { indexerId: 1, mostRecentFailure: ago(120_000) },
                { indexerId: 2, mostRecentFailure: ago(5_000) },
              ],
        ),
      )
    })
    const base = await kinoseed({ url: prowlarr, apiKey: KEY })
    // The search started 60 s ago: Kinozal failed during it, RuTracker before it.
    const response = await fetch(`${base}/prowlarr/failing?within=60000`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ indexers: ['Kinozal'] })
    expect(seen.map(({ path }) => path).sort()).toEqual(['/api/v1/indexer', '/api/v1/indexerstatus'])
    expect(seen.every(({ key }) => key === KEY)).toBe(true)

    // More than ten minutes is no search's: Prowlarr keeps an indexer's last failure after it recovers.
    for (const within of ['', '-5', 'soon', '1.5', '600001', '99999999999999']) {
      expect((await fetch(`${base}/prowlarr/failing?within=${within}`)).status).toBe(400)
    }
  })

  it('doesn’t fetch the indexer list when nothing failed', async () => {
    const seen: string[] = []
    const prowlarr = await listen((request, response) => {
      seen.push(request.url!)
      response.setHeader('Content-Type', 'application/json')
      response.end('[]')
    })
    const response = await fetch(`${await kinoseed({ url: prowlarr, apiKey: KEY })}/prowlarr/failing?within=60000`)
    expect(await response.json()).toEqual({ indexers: [] })
    expect(seen).toEqual(['/api/v1/indexerstatus'])
  })

  it('reports a rejected key, a failing Prowlarr and one too slow to answer', async () => {
    const answering = (status: number) =>
      listen((request, response) => {
        response.statusCode = request.url === '/api/v1/indexerstatus' ? status : 200
        response.setHeader('Content-Type', 'application/json')
        response.end('[]')
      })
    const rejected = await fetch(`${await kinoseed({ url: await answering(401), apiKey: KEY })}/prowlarr/failing?within=0`)
    expect(rejected.status).toBe(502)
    expect(await rejected.json()).toEqual({ error: 'unauthorized' })

    const broken = await fetch(`${await kinoseed({ url: await answering(500), apiKey: KEY })}/prowlarr/failing?within=0`)
    expect(broken.status).toBe(502)
    expect(await broken.json()).toEqual({ error: 'upstream' })

    // indexerstatus never answers: the server gives up instead of holding the request.
    const hanging = await listen((request, response) => {
      if (request.url !== '/api/v1/indexerstatus') response.end('[]')
    })
    const slow = await fetch(`${await kinoseed({ url: hanging, apiKey: KEY, failingTimeoutMs: 50 })}/prowlarr/failing?within=0`)
    expect(slow.status).toBe(502)
    expect(await slow.json()).toEqual({ error: 'unreachable' })
  })

  it('downloads a .torrent through Prowlarr with the key added back', async () => {
    let seen: URL | undefined
    const prowlarr = await listen((request, response) => {
      seen = new URL(request.url!, 'http://x')
      response.setHeader('Content-Type', 'application/x-bittorrent')
      response.end(Buffer.from('d4:infod4:name4:Duneee'))
    })
    const base = await kinoseed({ url: prowlarr, apiKey: KEY })

    const token = encodeURIComponent('1/download?link=AAA&file=Dune')
    const response = await fetch(`${base}/prowlarr/download?token=${token}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/x-bittorrent')
    expect(await response.text()).toBe('d4:infod4:name4:Duneee')
    expect(seen?.pathname).toBe('/api/v1/indexer/1/download')
    expect(seen?.searchParams.get('link')).toBe('AAA')
    expect(seen?.searchParams.get('apikey')).toBe(KEY)
  })

  it('refuses an answer that is not a .torrent, like a proxy login page', async () => {
    const prowlarr = await listen((_request, response) => {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><title>Login</title>')
    })
    const base = await kinoseed({ url: prowlarr, apiKey: KEY })
    const response = await fetch(`${base}/prowlarr/download?token=${encodeURIComponent('1/download?link=A')}`)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'upstream' })
  })

  it('answers a redirect to a magnet link with the link', async () => {
    const prowlarr = await listen((_request, response) => {
      response.statusCode = 301
      response.setHeader('Location', 'magnet:?xt=urn:btih:abc&dn=Dune')
      response.end()
    })
    const base = await kinoseed({ url: prowlarr, apiKey: KEY })
    const response = await fetch(`${base}/prowlarr/download?token=${encodeURIComponent('1/download?link=A')}`)
    expect(await response.json()).toEqual({ magnet: 'magnet:?xt=urn:btih:abc&dn=Dune' })
  })

  it('follows a redirect to the tracker’s own link, without the key', async () => {
    const seen: { url?: string; key?: string }[] = []
    const prowlarr = await listen((request, response) => {
      seen.push({ url: request.url, key: request.headers['x-api-key'] as string | undefined })
      if (request.url!.startsWith('/api/v1/indexer/1/download')) {
        response.statusCode = 302
        response.setHeader('Location', '/tracker/dune.torrent')
        return response.end()
      }
      response.setHeader('Content-Type', 'application/x-bittorrent')
      response.end(Buffer.from('d4:infod4:name4:Duneee'))
    })
    const base = await kinoseed({ url: prowlarr, apiKey: KEY })
    const response = await fetch(`${base}/prowlarr/download?token=${encodeURIComponent('1/download?link=A')}`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('d4:infod4:name4:Duneee')
    expect(seen).toEqual([
      { url: `/api/v1/indexer/1/download?link=A&apikey=${KEY}`, key: KEY },
      { url: '/tracker/dune.torrent', key: undefined },
    ])
  })

  it('refuses a redirect to anything but a web address', async () => {
    const prowlarr = await listen((_request, response) => {
      response.statusCode = 302
      response.setHeader('Location', 'ftp://tracker.test/dune.torrent')
      response.end()
    })
    const base = await kinoseed({ url: prowlarr, apiKey: KEY })
    const response = await fetch(`${base}/prowlarr/download?token=${encodeURIComponent('1/download?link=A')}`)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'upstream' })
  })

  it('only downloads Prowlarr download links', async () => {
    const base = await kinoseed({ url: 'http://127.0.0.1:9', apiKey: KEY })
    for (const token of ['api/v1/indexer', '../1/download?link=a', '1/download']) {
      expect((await fetch(`${base}/prowlarr/download?token=${encodeURIComponent(token)}`)).status).toBe(400)
    }
  })
})

describe('readProwlarrApiKey', () => {
  it('reads <ApiKey> from Prowlarr’s config.xml', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kinoseed-prowlarr-'))
    try {
      const path = join(dir, 'config.xml')
      await writeFile(path, '<Config>\n  <Port>9696</Port>\n  <ApiKey>0123abcd</ApiKey>\n</Config>\n')
      expect(await readProwlarrApiKey(path)).toBe('0123abcd')
      await writeFile(path, '<Config></Config>')
      expect(await readProwlarrApiKey(path)).toBeUndefined()
      expect(await readProwlarrApiKey(join(dir, 'missing.xml'))).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
