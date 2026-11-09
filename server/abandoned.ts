import type { ServerResponse } from 'node:http'

/**
 * A signal that aborts once `response` closes: the browser's request is gone, so a request upstream
 * made for it is given up at once, rather than kept open until the service answers or undici gives
 * up on it, about 5 minutes later. A response that closes once it's sent has had its upstream
 * answer in full already, so aborting then changes nothing. Take it before the first `await`, so a
 * browser that leaves meanwhile is noticed.
 */
export function abandoned(response: ServerResponse): AbortSignal {
  const controller = new AbortController()
  response.once('close', () => controller.abort())
  return controller.signal
}
