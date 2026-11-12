// What the layout shift test (layoutShift.perf.ts) does with the page: records every layout shift
// it makes and the elements that moved, holds the answers of the routes a screen loads from and
// lets them land one at a time, in an order the test chooses, each painted before the next. Written
// for any screen: a screen gives the routes it holds and what each answer shows.
import type { Page, Request, Route } from '@playwright/test'

/** One layout shift: its score and the elements that moved, with their boxes before and after. */
export type Shift = { value: number; sources: string[] }

/**
 * Has the page record its layout shifts from its first frame, before any of its scripts: every
 * `layout-shift` entry without recent input, as web-vitals counts them, with the elements that
 * moved (tag, classes, and the box in the viewport before and after, `y/height`).
 */
export async function recordLayoutShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shifts: { value: number; sources: string[] }[] = []
    ;(window as unknown as { __layoutShifts: typeof shifts }).__layoutShifts = shifts
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
        if (entry.hadRecentInput) continue
        const sources = entry.sources.map((source) => `${named(source.node)} ${box(source.previousRect)} → ${box(source.currentRect)}`)
        shifts.push({ value: entry.value, sources })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  })
}

/** Resolves after two animation frames: whatever the page rendered before has been painted. */
export async function painted(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/** The layout shifts recorded so far, once the page has painted what it rendered. */
export async function layoutShifts(page: Page): Promise<Shift[]> {
  await painted(page)
  return page.evaluate(() => [...(window as unknown as { __layoutShifts: Shift[] }).__layoutShifts])
}

/** The layout shift of a load: the sum of its shifts, every one of them, rather than the worst window's. */
export function total(shifts: Shift[]): number {
  return shifts.reduce((sum, shift) => sum + shift.value, 0)
}

/** How long an answer may wait for its request before the test says the page never asked. */
const ASKED_LIMIT_MS = 10_000

/**
 * Holds every request to the named routes until `release` lets that route's answers land: the ones
 * held then, and every later one as it comes. Registered after `prepareApp`, so a released request
 * falls back to its mocked answer. `release` waits for the route to be asked first, so an answer
 * the page asks for only after another (a title after the torrents) can't be released before it,
 * and resolves once its answers have reached the page.
 */
export async function holdAnswers<Name extends string>(
  page: Page,
  routes: Record<Name, (url: URL) => boolean>,
): Promise<{ release: (name: Name) => Promise<void> }> {
  const held = new Map<Name, Route[]>()
  const released = new Set<Name>()
  const asked = new Map<Name, () => void>()
  for (const name of Object.keys(routes) as Name[]) {
    held.set(name, [])
    await page.route(routes[name], (route) => {
      if (released.has(name)) return route.fallback()
      held.get(name)!.push(route)
      asked.get(name)?.()
    })
  }
  const landed = async (request: Request) => {
    const response = await request.response()
    await response?.finished()
  }
  return {
    release: async (name) => {
      if (held.get(name)!.length === 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`The page didn't ask for "${name}" in ${ASKED_LIMIT_MS} ms`)), ASKED_LIMIT_MS)
          asked.set(name, () => {
            clearTimeout(timer)
            resolve()
          })
        })
      }
      released.add(name)
      const routesHeld = held.get(name)!.splice(0)
      await Promise.all(routesHeld.map((route) => route.fallback()))
      await Promise.all(routesHeld.map((route) => landed(route.request())))
    },
  }
}
