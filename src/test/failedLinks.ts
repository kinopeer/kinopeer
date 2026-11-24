// The check that every place showing a failure of qBittorrent, Prowlarr or TMDB names the link that
// failed (#600, docs/TESTING.md → Places that name a failed link): every way each service's call
// can fail, and the one call each place's own test file makes to run them all through the place.
import { describe, expect, it, vi } from 'vitest'
import { ProxySignInError } from '../api/fetchKinopeer'
import { ProwlarrError, ProwlarrKeyReadError, ProwlarrSetupError } from '../api/prowlarr/errors'
import { KinopeerUnreachableError, QbittorrentError, UnauthorizedError } from '../api/qbittorrent/errors'
import { TmdbError, TmdbKeyError, TmdbKeyReadError } from '../api/tmdb/errors'

export type Service = 'qbittorrent' | 'prowlarr' | 'tmdb'
export type Build = 'server' | 'webui'

/**
 * The link on the way to a service that failed: Kinopeer's server (nothing answered for it, or
 * something in front answered in its place), the service itself, its key (none, or one it refused),
 * or, in the WebUI build, qBittorrent not giving what it keeps for the page (`store`).
 */
export type Link = 'kinopeer' | 'service' | 'key' | 'store'

interface Way {
  /** What happened, as the test's name says it. */
  name: string
  link: Link
  /** What the service's client throws then (a new one for each run). */
  error: () => unknown
}

const kinopeer: Way[] = [
  { name: 'nothing answered for Kinopeer’s server', link: 'kinopeer', error: () => new TypeError('Failed to fetch') },
  { name: 'a sign-in proxy in front of Kinopeer redirected', link: 'kinopeer', error: () => new ProxySignInError() },
  { name: 'something in front of Kinopeer’s server answered for it', link: 'kinopeer', error: () => new KinopeerUnreachableError(502) },
  // With a status a place reads as the service's own refusal: a proxy answers whatever it answers.
  { name: 'something in front of Kinopeer’s server answered 404', link: 'kinopeer', error: () => new KinopeerUnreachableError(404) },
  { name: 'something in front of Kinopeer’s server answered 409', link: 'kinopeer', error: () => new KinopeerUnreachableError(409) },
]

/**
 * Every way each service's call fails, by build: what its client throws (src/api/*), and the link
 * that failed. Not a call the app gives up itself (an abort, the poll's time limit), which isn't a
 * link failing. A new way to fail is a row here, and every place's check runs it; a new kind of link
 * is a member of `Link`, which every place then has to say.
 */
export const WAYS: Record<Build, Record<Service, Way[]>> = {
  server: {
    qbittorrent: [...kinopeer, { name: 'qBittorrent didn’t answer the bridge', link: 'service', error: () => new QbittorrentError('qBittorrent responded 502', 502) }],
    tmdb: [
      ...kinopeer,
      { name: 'TMDB didn’t answer the bridge', link: 'service', error: () => new TmdbError('TMDB responded 502', 502) },
      { name: 'there’s no TMDB key, or TMDB refused it', link: 'key', error: () => new TmdbKeyError(401) },
    ],
    prowlarr: [
      ...kinopeer,
      { name: 'Prowlarr didn’t answer the bridge', link: 'service', error: () => new ProwlarrError('Prowlarr did not answer', 502, 'unreachable') },
      { name: 'the server has no address or key for Prowlarr', link: 'key', error: () => new ProwlarrSetupError(503, 'not-configured') },
      { name: 'Prowlarr refused the server’s key', link: 'key', error: () => new ProwlarrSetupError(502, 'unauthorized') },
    ],
  },
  // No Kinopeer server: the page calls each service itself, so nothing answering is the service.
  webui: {
    qbittorrent: [
      { name: 'nothing answered for qBittorrent', link: 'service', error: () => new TypeError('Failed to fetch') },
      { name: 'qBittorrent failed the call', link: 'service', error: () => new QbittorrentError('qBittorrent responded 500', 500) },
    ],
    tmdb: [
      { name: 'nothing answered for TMDB', link: 'service', error: () => new TypeError('Failed to fetch') },
      { name: 'TMDB failed the call', link: 'service', error: () => new TmdbError('TMDB responded 503', 503) },
      { name: 'there’s no TMDB key, or TMDB refused it', link: 'key', error: () => new TmdbKeyError(401) },
      { name: 'qBittorrent didn’t answer for the TMDB key', link: 'store', error: () => new TmdbKeyReadError(new TypeError('Failed to fetch')) },
      { name: 'qBittorrent’s session ended as the TMDB key was read', link: 'store', error: () => new TmdbKeyReadError(new UnauthorizedError()) },
    ],
    prowlarr: [
      { name: 'nothing answered for Prowlarr', link: 'service', error: () => new TypeError('Failed to fetch') },
      { name: 'Prowlarr failed the call', link: 'service', error: () => new ProwlarrError('Prowlarr answered with no JSON', 502, 'upstream') },
      { name: 'qBittorrent keeps no address or key for Prowlarr', link: 'key', error: () => new ProwlarrSetupError(503, 'not-configured') },
      { name: 'Prowlarr refused the key', link: 'key', error: () => new ProwlarrSetupError(401, 'unauthorized') },
      { name: 'qBittorrent didn’t answer for Prowlarr’s address and key', link: 'store', error: () => new ProwlarrKeyReadError(new TypeError('Failed to fetch')) },
    ],
  },
}

export interface FailedLinkPlace {
  service: Service
  /** The builds the place shows in (both by default). */
  builds?: Build[]
  /**
   * Renders the place with its call to the service failing with `error`, through the place's own
   * wiring (its client mocked to throw it), and gives the smallest element that shows the failure:
   * its alert or banner, or the screen (`main`) or the sheet where a failed state takes the
   * content's place; or what a person hears for it where that's a name, not a text (the poll's
   * ring). A component given the poll's reading (`unreachable`) is given `unreachable(error)`,
   * as the poll reads it.
   */
  show: (error: unknown) => Promise<HTMLElement | string>
  /**
   * What the place says for each link a way of its builds fails at: a phrase of its text that names
   * that link. Every way checks that the element says its link's phrase and no other link's, so two
   * links can't share a text, unless the place gives both the same phrase: then it says the same
   * for both, which the declaration shows (the add sheet names Prowlarr for its key and for Prowlarr
   * alike).
   */
  says: Partial<Record<Link, string | RegExp>>
}

const textOf = (shown: HTMLElement | string) => (typeof shown === 'string' ? shown : (shown.textContent ?? '')).replace(/\s+/g, ' ')
const has = (text: string, said: string | RegExp) => (typeof said === 'string' ? text.includes(said) : said.test(text))

/** Runs every way its service's call can fail (`WAYS`) through `place`, in each build it shows in. */
export function namesTheFailedLink(place: string, { service, builds = ['server', 'webui'], show, says }: FailedLinkPlace) {
  describe(`${place} names the link that failed`, () => {
    for (const build of builds) {
      it.each(WAYS[build][service])(`${build}: $name`, async ({ link, error }) => {
        if (build === 'webui') vi.stubGlobal('__WEBUI__', true)
        const said = says[link]
        // A new kind of link reaches a place that says nothing for it yet.
        expect(said, `${place} says nothing for the ${link} link`).toBeDefined()
        const text = textOf(await show(error()))
        expect(has(text, said!), `says “${String(said)}” in “${text}”`).toBe(true)
        const others = Object.entries(says).filter(([, phrase]) => String(phrase) !== String(said) && has(text, phrase))
        expect(others.map(([other]) => other), `says another link’s phrase for the ${link} link in “${text}”`).toEqual([])
      })
    }
  })
}
