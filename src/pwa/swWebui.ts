/**
 * How the service worker (src/sw.ts) loads a page in the Alternative WebUI build (#360), which
 * qBittorrent serves itself. Kept apart from workbox and the worker's globals, with only the shapes
 * it uses, so it's tested as plain logic.
 *
 * The page comes from the network first, not the precache as in the server's build: once Kinopeer is
 * turned off in qBittorrent's settings (or its folder is gone, or a sign-in proxy answers in front of
 * qBittorrent), the same address answers with something else, which the worker shows instead of the
 * app it cached. It then removes itself and its caches, so the next load is that page's alone; the
 * app registers the worker again whenever it loads (vite-plugin-pwa's registerSW.js). Only when the
 * network doesn't answer at all does the precached index.html open, so the app can say qBittorrent
 * doesn't answer.
 */

/**
 * What only Kinopeer's index.html has (the `<meta>` in the project's index.html, which
 * vite.config.test.ts checks the build keeps): qBittorrent's own interface, another Alternative WebUI
 * and a sign-in page don't name the application Kinopeer.
 */
export const KINOPEER_PAGE_MARK = '<meta name="application-name" content="Kinopeer"'

/** Whether a page's answer is Kinopeer's: a success whose HTML has the mark. A redirect isn't. */
export async function isKinopeerPage(response: Response): Promise<boolean> {
  return response.ok && (await response.clone().text()).includes(KINOPEER_PAGE_MARK)
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

/**
 * The answer to a page load: the network's, from Kinopeer or not, removing the worker first when it
 * isn't Kinopeer's; the precached index.html when the network doesn't answer, else the network's error.
 */
export async function loadPage(request: Request, load: PageLoad): Promise<Response> {
  let response: Response
  try {
    response = await load.fetch(request)
  } catch (error) {
    const cached = await load.cachedPage()
    if (cached) return cached
    throw error
  }
  if (!(await isKinopeerPage(response))) await load.forget()
  return response
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
