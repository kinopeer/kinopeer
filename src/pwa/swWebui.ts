/**
 * How the service worker (src/sw.ts) loads a page in the Alternative WebUI build (#360), which
 * qBittorrent serves itself. Kept apart from workbox and the worker's globals, with only the shapes
 * it uses, so it's tested as plain logic.
 *
 * The page comes from the network first, not the precache as in the server's build: once Kinopeer is
 * turned off in qBittorrent's settings (or its folder is gone, or a sign-in proxy answers in front of
 * qBittorrent), the same address answers with something else, which the worker shows instead of the
 * app it cached. It then removes itself and its caches, so the next load is that page's alone; the
 * app registers the worker again whenever it loads (vite-plugin-pwa's registerSW.js). When nothing
 * usable answers (no answer, no whole page in PAGE_TIMEOUT_MS, a proxy's gateway error), the precached
 * index.html opens instead and the worker stays, so the app can say qBittorrent doesn't answer.
 *
 * How an answer is read (`pageAnswer`) is a heuristic, with this scope: Kinopeer's page is a success
 * whose HTML has the mark; nothing usable is no answer or no whole page in time, a gateway failure
 * (GATEWAY_FAILURES: what nginx, Caddy, Cloudflare and other proxies answer while qBittorrent behind
 * them doesn't) and a body that broke off;
 * anything else is another page now answering here: a success without the mark (qBittorrent's own
 * interface, another Alternative WebUI, a sign-in page), a redirect (a sign-in proxy) and any other
 * error (qBittorrent's 500 for a folder with no index.html, a proxy's 401 or 403). A proxy that
 * answers its own outage with another status or a page of its own (Cloudflare's 525 and 526 for a
 * certificate it can't use among them, which are a setup to fix rather than an outage) is read as
 * another page: the worker goes, and only the offline app is lost until Kinopeer loads again.
 */

/**
 * What only Kinopeer's index.html has (the `<meta>` in the project's index.html, which
 * vite.config.test.ts checks the dev server's page keeps; the build only adds tags to it):
 * qBittorrent's own interface, another Alternative WebUI and a sign-in page don't name the
 * application Kinopeer.
 */
export const KINOPEER_PAGE_MARK = '<meta name="application-name" content="Kinopeer"'

/**
 * The addresses of the app's page, the only ones the worker's page route takes (src/sw.ts), matched on
 * the path and query: `/` and `/index.html`, since the routes go after the `#`. Any other page opened
 * in a tab (an icon, version.json, qBittorrent's API) is left to the network, so it never reads as
 * another page answering in Kinopeer's place.
 */
export const WEBUI_PAGES: RegExp[] = [/^\/(index\.html)?(\?.*)?$/]

/**
 * How long a page load waits for qBittorrent's whole page, its body read included, before the
 * precached app opens: index.html is a few
 * kilobytes, so a qBittorrent that hasn't sent it by then is stuck, or a proxy is waiting on it, and
 * the app opens at once and says so through its own calls, as before the network came first.
 */
export const PAGE_TIMEOUT_MS = 5_000

/**
 * What proxies answer while the qBittorrent behind them doesn't: Bad Gateway, Service Unavailable,
 * Gateway Timeout, and Cloudflare's own for an origin that doesn't answer (520 to 524, and 530 for a
 * tunnel with no connector or a name it can't resolve: developers.cloudflare.com/support/troubleshooting/
 * http-status-codes/cloudflare-5xx-errors/).
 */
export const GATEWAY_FAILURES: readonly number[] = [502, 503, 504, 520, 521, 522, 523, 524, 530]

/** Kinopeer's page, nothing usable, or another page now answering at Kinopeer's address (the scope above). */
export type PageAnswer = 'kinopeer' | 'unanswered' | 'other'

/** What a page's answer is (the scope above). The body read is a clone's, so the answer can still be handed on. */
export async function pageAnswer(response: Response): Promise<PageAnswer> {
  if (GATEWAY_FAILURES.includes(response.status)) return 'unanswered'
  if (!response.ok) return 'other'
  let html: string
  try {
    html = await response.clone().text()
  } catch {
    return 'unanswered'
  }
  return html.includes(KINOPEER_PAGE_MARK) ? 'kinopeer' : 'other'
}

/** What loading a page needs from the worker. */
export interface PageLoad {
  /** The network's answer to the request; throws when nothing answers. */
  fetch: (request: Request) => Promise<Response>
  /** The precached index.html, if the precache has it. */
  cachedPage: () => Promise<Response | undefined>
  /** Unregisters the worker and deletes its caches. */
  forget: () => Promise<void>
}

/** `promise`'s value once it settles within `ms`, else undefined, as it is when it rejects. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms)
    const settle = (value: T | undefined) => {
      clearTimeout(timer)
      resolve(value)
    }
    promise.then(settle, () => settle(undefined))
  })
}

/**
 * The answer to a page load. Kinopeer's page from the network as it is. Another page as it is, the
 * worker forgotten first; a failure to forget doesn't hold the page back. When nothing usable answered,
 * the precached index.html, else what the network gives in the end: its answer or its error.
 */
export async function loadPage(request: Request, load: PageLoad): Promise<Response> {
  const network = load.fetch(request)
  const read = await within(
    network.then(async (response) => ({ response, kind: await pageAnswer(response) })),
    PAGE_TIMEOUT_MS,
  )
  if (read?.kind === 'kinopeer') return read.response
  if (read?.kind === 'other') {
    await load.forget().catch(() => {})
    return read.response
  }
  return (await load.cachedPage()) ?? network
}

/** What forgetting the worker needs: its registration and the page's cache storage. */
export interface Forgettable {
  registration: { unregister: () => Promise<boolean> }
  caches: { delete: (name: string) => Promise<boolean> }
}

/**
 * Unregisters the worker and deletes the caches it filled, named in `cacheNames`, and no others: the
 * origin is qBittorrent's, which another interface may cache under too.
 */
export async function forgetWorker({ registration, caches }: Forgettable, cacheNames: readonly string[]): Promise<void> {
  await Promise.all([registration.unregister(), ...cacheNames.map((name) => caches.delete(name))])
}
