import type { IncomingMessage, ServerResponse } from 'node:http'

/** Answers with JSON that is never cached: the server's own /api routes. */
export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

/** Reads a JSON request body of at most `maxBytes`; throws on anything else. */
export async function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > maxBytes) throw new Error('Body too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Only JSON bodies change anything: a cross-site form can't send one without a CORS preflight,
 * which never succeeds here.
 */
export function isJsonRequest(request: IncomingMessage): boolean {
  return request.headers['content-type']?.startsWith('application/json') ?? false
}
