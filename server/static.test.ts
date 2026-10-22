import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, get as httpGet, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pickEncoding, staticMiddleware } from './static.ts'

let root: string
let server: Server
let app: string
const script = `console.log(${JSON.stringify('x'.repeat(4000))})`

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'kinoseed-static-'))
  await mkdir(join(root, 'assets'))
  await mkdir(join(root, 'icons'))
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Kinoseed</title>')
  await writeFile(join(root, 'sw.js'), 'self.skipWaiting()')
  await writeFile(join(root, 'assets', 'index-abc123.js'), script)
  await writeFile(join(root, 'icons', 'icon-192.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await writeFile(join(tmpdir(), 'kinoseed-secret.txt'), 'secret')

  const middleware = staticMiddleware({ root })
  server = createServer((request, response) =>
    middleware(request, response, () => {
      response.statusCode = 404
      response.end('fallback')
    }),
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  app = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
})

/** Raw bytes, without fetch decompressing them. */
function get(path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    httpGet(new URL(path, app), { headers }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }))
    }).on('error', reject)
  })
}

describe('staticMiddleware', () => {
  it('serves index.html for app routes, revalidated on every load', async () => {
    for (const path of ['/', '/search?q=alien', '/title/movie/771', '/torrent/abcdef']) {
      const response = await get(path)
      expect(response.status, path).toBe(200)
      expect(response.headers['content-type']).toBe('text/html; charset=utf-8')
      expect(response.headers['cache-control']).toBe('no-cache')
      expect(response.body.toString()).toContain('<title>Kinoseed</title>')
    }
  })

  it('never lets the service worker be cached', async () => {
    const response = await get('/sw.js')
    expect(response.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-cache')
  })

  it('caches hashed assets for a year and compresses them', async () => {
    const brotli = await get('/assets/index-abc123.js', { 'Accept-Encoding': 'gzip, deflate, br' })
    expect(brotli.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(brotli.headers['content-encoding']).toBe('br')
    expect(brotliDecompressSync(brotli.body).toString()).toBe(script)

    const gzip = await get('/assets/index-abc123.js', { 'Accept-Encoding': 'gzip' })
    expect(gzip.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(gzip.body).toString()).toBe(script)

    const plain = await get('/assets/index-abc123.js')
    expect(plain.headers['content-encoding']).toBeUndefined()
    expect(plain.body.toString()).toBe(script)
  })

  it('answers 304 to a matching ETag', async () => {
    const first = await get('/icons/icon-192.png')
    expect(first.headers['content-type']).toBe('image/png')
    const second = await get('/icons/icon-192.png', { 'If-None-Match': String(first.headers.etag) })
    expect(second.status).toBe(304)
  })

  it('passes on missing files and paths outside the build', async () => {
    expect((await get('/assets/index-gone.js')).body.toString()).toBe('fallback')
    expect((await get('/favicon.ico')).body.toString()).toBe('fallback')
    expect((await get('/..%2fkinoseed-secret.txt')).body.toString()).toBe('fallback')
    expect((await get('/%E0%A4%A')).body.toString()).toBe('fallback')
  })
})

describe('pickEncoding', () => {
  it('prefers Brotli, then gzip, and honours q=0', () => {
    expect(pickEncoding('gzip, deflate, br')).toBe('br')
    expect(pickEncoding('gzip, br;q=0')).toBe('gzip')
    expect(pickEncoding('identity')).toBeUndefined()
    expect(pickEncoding(undefined)).toBeUndefined()
  })
})
