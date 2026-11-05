import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { constants, createBrotliCompress, createGzip } from 'node:zlib'
import type { Middleware } from './prowlarr.ts'

/**
 * Serves the built app (dist/) in production:
 * - hashed files under /assets/ are cached for a year, everything else is revalidated, and the
 *   service worker (sw.js) is never cached, so a new version reaches installed apps;
 * - app routes (/search, /title/movie/1, …) get index.html, the app routes them itself;
 * - text files are compressed with Brotli or gzip when the browser accepts it.
 */
export interface StaticConfig {
  /** Absolute path to the build output. */
  root: string
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt'])
const IMMUTABLE = 'public, max-age=31536000, immutable'
const REVALIDATE = 'no-cache'

function cacheControl(path: string): string {
  return path.startsWith('/assets/') ? IMMUTABLE : REVALIDATE
}

async function file(path: string) {
  try {
    const info = await stat(path)
    return info.isFile() ? info : undefined
  } catch {
    return undefined
  }
}

/** The encoding to compress with, from the browser's Accept-Encoding. */
export function pickEncoding(header: string | string[] | undefined): 'br' | 'gzip' | undefined {
  const accepted = new Set(
    String(header ?? '')
      .split(',')
      .map((part) => part.trim().split(';'))
      .filter(([, q]) => q?.trim() !== 'q=0')
      .map(([name]) => name.trim().toLowerCase()),
  )
  if (accepted.has('br')) return 'br'
  if (accepted.has('gzip')) return 'gzip'
  return undefined
}

async function send(request: IncomingMessage, response: ServerResponse, path: string, urlPath: string, size: number, mtime: Date) {
  const ext = extname(path)
  const etag = `W/"${size.toString(16)}-${mtime.getTime().toString(16)}"`
  response.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream')
  response.setHeader('Cache-Control', cacheControl(urlPath))
  response.setHeader('ETag', etag)
  response.setHeader('Last-Modified', mtime.toUTCString())
  response.setHeader('X-Content-Type-Options', 'nosniff')
  if (request.headers['if-none-match'] === etag) {
    response.statusCode = 304
    return void response.end()
  }

  const encoding = COMPRESSIBLE.has(ext) && size > 1024 ? pickEncoding(request.headers['accept-encoding']) : undefined
  if (COMPRESSIBLE.has(ext)) response.setHeader('Vary', 'Accept-Encoding')
  if (encoding) response.setHeader('Content-Encoding', encoding)
  else response.setHeader('Content-Length', size)
  response.statusCode = 200
  if (request.method === 'HEAD') return void response.end()

  const source = createReadStream(path)
  if (!encoding) return pipeline(source, response)
  const compress =
    encoding === 'br' ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }) : createGzip()
  return pipeline(source, compress, response)
}

export function staticMiddleware(config: StaticConfig): Middleware {
  const root = normalize(config.root)
  const index = join(root, 'index.html')

  return (request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next()
    let urlPath: string
    try {
      urlPath = decodeURIComponent(new URL(request.url ?? '/', 'http://kinopeer.local').pathname)
    } catch {
      return next()
    }
    const path = normalize(join(root, urlPath))
    if (path !== root && !path.startsWith(root + sep)) return next()

    void (async () => {
      const found = urlPath.endsWith('/') ? undefined : await file(path)
      if (found) return send(request, response, path, urlPath, found.size, found.mtime)
      // A missing file with an extension (a stale /assets/… link, /favicon.ico) is a real 404; any
      // other path is an app route.
      if (extname(urlPath)) return next()
      const shell = await file(index)
      if (!shell) return next()
      return send(request, response, index, '/index.html', shell.size, shell.mtime)
    })().catch(() => {
      if (response.headersSent) response.destroy()
      else next()
    })
  }
}
