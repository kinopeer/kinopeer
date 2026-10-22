import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { tmdbMiddleware, type TmdbConfig } from './tmdb.ts'

const servers: Server[] = []

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

interface Seen {
  url?: string
  authorization?: string
  cookie?: string
}

/** TMDB's API and image hosts, recording what reached them. */
async function fakeTmdb() {
  const seen: Seen[] = []
  const base = await listen((request, response) => {
    seen.push({ url: request.url, authorization: request.headers.authorization, cookie: request.headers.cookie })
    if (request.url?.startsWith('/t/p/')) {
      response.setHeader('Content-Type', 'image/jpeg')
      response.setHeader('Cache-Control', 'max-age=31536000')
      return response.end(Buffer.from([0xff, 0xd8, 0xff]))
    }
    response.setHeader('Content-Type', 'application/json;charset=utf-8')
    response.setHeader('Set-Cookie', 'tracking=1')
    response.end(JSON.stringify({ results: [] }))
  })
  return { base, seen }
}

async function kinoseed(config: TmdbConfig): Promise<string> {
  const middleware = tmdbMiddleware(config)
  return listen((request, response) =>
    middleware(request, response, () => {
      response.statusCode = 404
      response.end('fallback')
    }),
  )
}

describe('tmdbMiddleware', () => {
  it('adds a v3 key as a query parameter and drops browser cookies', async () => {
    const tmdb = await fakeTmdb()
    const app = await kinoseed({ apiKey: ' abc123 ', apiBase: `${tmdb.base}/3` })

    const response = await fetch(`${app}/tmdb/search/multi?query=alien&language=ru-RU`, { headers: { Cookie: 'SID=secret' } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: [] })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(tmdb.seen).toEqual([{ url: '/3/search/multi?query=alien&language=ru-RU&api_key=abc123', authorization: undefined, cookie: undefined }])
  })

  it('sends a v4 read access token as a bearer token', async () => {
    const tmdb = await fakeTmdb()
    const app = await kinoseed({ apiKey: 'eyJhbGciOi.token', apiBase: `${tmdb.base}/3` })

    await fetch(`${app}/tmdb/movie/771`)

    expect(tmdb.seen).toEqual([{ url: '/3/movie/771', authorization: 'Bearer eyJhbGciOi.token', cookie: undefined }])
  })

  it('reads the key on every request, so a key saved from the app applies at once', async () => {
    const tmdb = await fakeTmdb()
    let key: string | undefined
    const app = await kinoseed({ apiKey: () => key, apiBase: `${tmdb.base}/3` })

    expect((await fetch(`${app}/tmdb/movie/771`)).status).toBe(401)
    key = 'saved'
    expect((await fetch(`${app}/tmdb/movie/771`)).status).toBe(200)
    expect(tmdb.seen.map((request) => request.url)).toEqual(['/3/movie/771?api_key=saved'])
  })

  it('answers 401 without a key, so the app reports a missing key', async () => {
    const app = await kinoseed({})

    const response = await fetch(`${app}/tmdb/movie/771`)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ status_message: 'The TMDB API key is not set' })
  })

  it('serves images without a key, with their cache headers', async () => {
    const tmdb = await fakeTmdb()
    const app = await kinoseed({ imageBase: `${tmdb.base}/t/p` })

    const response = await fetch(`${app}/tmdb-img/w342/poster.jpg`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('max-age=31536000')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]))
    expect(tmdb.seen[0].url).toBe('/t/p/w342/poster.jpg')
  })

  it('reports an unreachable TMDB without the key', async () => {
    const app = await kinoseed({ apiKey: 'abc123', apiBase: 'http://127.0.0.1:1/3' })

    const response = await fetch(`${app}/tmdb/movie/771`)

    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('abc123')
  })

  it('leaves other paths and methods alone', async () => {
    const app = await kinoseed({ apiKey: 'abc123' })

    expect(await (await fetch(`${app}/tmdbx/movie`)).text()).toBe('fallback')
    expect((await fetch(`${app}/tmdb/movie/771`, { method: 'POST' })).status).toBe(405)
  })
})
