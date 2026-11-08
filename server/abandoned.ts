import type { ServerResponse } from 'node:http'

/**
 * A signal that aborts once the browser's request is gone before `response` was sent: a request
 * upstream made for it is then given up at once, rather than kept open until the service answers
 * or undici gives up on it, about 5 minutes later. Take it before the first `await`, so a browser
 * that leaves meanwhile is noticed.
 */
export function abandoned(response: ServerResponse): AbortSignal {
  const controller = new AbortController()
  response.once('close', () => {
    if (!response.writableFinished) controller.abort()
  })
  return controller.signal
}
