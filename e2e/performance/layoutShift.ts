// What the layout shift test (layoutShift.perf.ts) does with the page: records every layout shift
// it makes and the elements that moved, holds every answer a screen loads from and lets them land
// one at a time, each painted before the next, in an order a rule chooses. A screen gives its chain
// of answers and what each shows. The rules the order follows are in scripts/layout-shift/answers.ts,
// those the shifts are judged by in scripts/layout-shift/budget.ts.
import type { Page, Request, Route } from '@playwright/test'
import { askedEarly, chainOf, chainProblems, claimant, due, pick, type Held, type Link, type Order } from '../../scripts/layout-shift/answers.ts'
import type { Shift } from '../../scripts/layout-shift/budget.ts'

/** What the page keeps: its shifts, or null when the browser doesn't report layout shifts at all. */
type Recorded = { __layoutShifts: Shift[] | null }

/**
 * Has the page record its layout shifts from its first frame, before any of its scripts: every
 * `layout-shift` entry, with the elements that moved (tag, classes, and the box in the viewport
 * before and after, `y/height`) and whether it came within 500 ms of a click or a key press
 * (`afterInput`), which web-vitals leaves out and this reading keeps, so a screen reached by a
 * click is still read. A browser without the entry type would record nothing, which would read as
 * nothing having moved: it records null instead, and `layoutShifts` fails.
 */
export async function recordLayoutShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const recorded = window as unknown as Recorded
    if (!PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
      recorded.__layoutShifts = null
      return
    }
    const shifts: Shift[] = []
    recorded.__layoutShifts = shifts
    const named = (node: Node | null) =>
      node instanceof Element ? [node.tagName.toLowerCase(), ...node.classList].join('.') : (node?.nodeName ?? 'gone')
    const box = (rect: DOMRectReadOnly) => `${Math.round(rect.y)}/${Math.round(rect.height)}`
    type Entry = PerformanceEntry & {
      value: number
      hadRecentInput: boolean
      sources: { node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[]
    }
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Entry[]) {
        const sources = entry.sources.map((source) => `${named(source.node)} ${box(source.previousRect)} → ${box(source.currentRect)}`)
        shifts.push({ value: entry.value, sources, afterInput: entry.hadRecentInput })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
}

/** Resolves after two animation frames: whatever the page rendered before has been painted. */
export async function painted(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/**
 * The layout shifts recorded so far, once the page has painted what it rendered. Fails when the
 * browser doesn't report them, rather than hand over a reading of nothing.
 */
export async function layoutShifts(page: Page): Promise<Shift[]> {
  await painted(page)
  const shifts = await page.evaluate(() => (window as unknown as Recorded).__layoutShifts)
  if (shifts === null) throw new Error("This browser doesn't report layout shifts (no `layout-shift` in `PerformanceObserver.supportedEntryTypes`): nothing can be read")
  return shifts
}

/** How long the page may take to ask for an answer its chain says is due before the test says it never asked. */
const ASKED_LIMIT_MS = 10_000

/** A screen's answer: the requests it is, where it sits in the chain, and what it shows once landed. */
export type Answer = Link & {
  /** Whether a request is this answer, by its address and method. */
  matches: (url: URL, method: string) => boolean
  /**
   * Waits for what the answer shows, if anything: its own content, so it painted before the next
   * lands. Given the answers landed so far, for content that needs another answer as well.
   */
  shown?: (page: Page, landed: ReadonlySet<string>) => Promise<void>
  /** The answer asks the same address again on its own (the torrents' poll): a repeat is its later request, not a request the case doesn't name. */
  polls?: true
}

/** What a load found besides the reading: the order the answers landed in and the requests no answer is. */
export type Landing = { landed: string[]; unnamed: string[] }

/**
 * Holds every request the page sends but the document and the build's own files (`built`), and lets
 * the screen's answers land one at a time, after the page's fonts are ready (the web font's files are
 * the build's, which would land by the clock and move the text when they did), as a page the
 * service worker serves has them, in `order` (scripts/layout-shift/answers.ts): before each,
 * it waits for every answer the chain says is due to be asked, so what is held when it chooses
 * doesn't depend on how fast the page asked; then it lets the held answer asked first (or last) land,
 * waits for what it shows and for a painted frame. An answer's later requests (another poster, the
 * next poll) land as they come once it has. A request that is no answer of the chain, or the same
 * address asked again beyond the answers that claim it (`claimant`), lands too, and is named in
 * `unnamed`, which fails the test; one the page sends before its chain says it would fails the load
 * at once, as does an answer due but not asked in `ASKED_LIMIT_MS`.
 *
 * Registered after `prepareApp`, so a request let go falls back to its mocked answer. Call before
 * the page opens; `land` opens nothing itself.
 */
export async function holdAnswers(
  page: Page,
  answers: Record<string, Answer>,
  order: Order,
  built: ReadonlySet<string>,
): Promise<{ land: () => Promise<Landing> }> {
  const chain = chainOf(answers)
  const problems = chainProblems(chain)
  if (problems.length > 0) throw new Error(`The screen's chain of answers is wrong:\n${problems.join('\n')}`)
  const held = new Map<string, Route[]>()
  const firstAsked = new Map<string, number>()
  const released = new Set<string>()
  const asked = new Map<string, () => void>()
  const unnamed: string[] = []
  const addresses = new Set<string>()
  const polls = new Set(Object.keys(answers).filter((name) => answers[name].polls))
  let requests = 0
  let early: string | undefined
  await page.route(
    (url) => !built.has(url.pathname),
    (route) => {
      const request = route.request()
      if (request.isNavigationRequest()) return route.fallback()
      const url = new URL(request.url())
      const address = `${request.method()} ${url.pathname}${url.search}`
      const candidates = Object.keys(answers).filter((name) => answers[name].matches(url, request.method()))
      const name = claimant(candidates, new Set(firstAsked.keys()), { repeat: addresses.has(address), polls })
      addresses.add(address)
      if (name === undefined) {
        unnamed.push(address)
        return route.fallback()
      }
      if (released.has(name)) return route.fallback()
      if (!firstAsked.has(name)) {
        firstAsked.set(name, requests++)
        early ??= askedEarly(chain, name, released)
      }
      held.set(name, [...(held.get(name) ?? []), route])
      asked.get(name)?.()
    },
  )
  const askedFor = (name: string) =>
    firstAsked.has(name)
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`The page didn't ask for "${name}" in ${ASKED_LIMIT_MS} ms, though its chain says it's due once ${[...released].join(', ')} landed`)),
            ASKED_LIMIT_MS,
          )
          asked.set(name, () => {
            clearTimeout(timer)
            resolve()
          })
        })
  const landedOne = async (request: Request) => {
    const response = await request.response()
    await response?.finished()
  }
  return {
    land: async () => {
      await page.evaluate(() => document.fonts.ready)
      await painted(page)
      const landed = new Set<string>()
      while (landed.size < Object.keys(answers).length) {
        await Promise.all(due(chain, new Set(firstAsked.keys()), landed).map(askedFor))
        if (early) throw new Error(early)
        const waiting: Held[] = [...held.keys()].filter((name) => !released.has(name)).map((name) => ({ name, asked: firstAsked.get(name)! }))
        const next = pick(waiting, order)
        released.add(next)
        const routes = held.get(next)!.splice(0)
        await Promise.all(routes.map((route) => route.fallback()))
        await Promise.all(routes.map((route) => landedOne(route.request())))
        landed.add(next)
        await answers[next].shown?.(page, landed)
        await painted(page)
      }
      return { landed: [...landed], unnamed }
    },
  }
}
