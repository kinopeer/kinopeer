import { readFileSync } from 'node:fs'
import { AxeBuilder } from '@axe-core/playwright'
import { expect as base, test as playwrightTest, type Locator, type Page } from '@playwright/test'
import { judge, readBudgets, stateOf, unknownTags, type Budgets, type Violation } from '../scripts/accessibility/budget.ts'

/**
 * Playwright's `test` and `expect` for the screenshot tests, where every screenshot also has axe read
 * the state it shows against its budgets, `budgets.accessibility` in checks.json (docs/QUALITY.md →
 * The accessibility budget). The read is in `toHaveScreenshot` itself rather than a helper a spec
 * calls beside it, so a new screenshot can't be taken without it; oxlint refuses `test`, `expect` and
 * `mergeExpects` from `@playwright/test` in the specs, its default export too (.oxlintrc.json).
 */
export const BUDGETS = readBudgets(JSON.parse(readFileSync(new URL('../checks.json', import.meta.url), 'utf8')))

/**
 * What axe finds broken on the page, by the tags checks.json names, as the budget's rules take it.
 * axe skips a tag none of its rules has without a word, so a tag it doesn't know (`wcag22AA`) fails
 * the read rather than leave that tag's rules unread.
 */
async function violations(page: Page, tags: string[]): Promise<Violation[] | string> {
  const results = await new AxeBuilder({ page }).withTags(tags).analyze()
  // The analysis leaves axe in the page, the same axe that read it.
  const known = await page.evaluate(() => (window as unknown as { axe: { getRules: () => { tags: string[] }[] } }).axe.getRules().flatMap((rule) => rule.tags))
  const unknown = unknownTags(tags, known)
  if (unknown) return unknown
  return results.violations.map(({ id, help, helpUrl, nodes }) => ({
    id,
    help,
    helpUrl,
    nodes: nodes.map(({ target, html }) => ({ target: target.flat().join(' '), html })),
  }))
}

/**
 * Reads the state a screenshot shows: after the screenshot, so nothing axe does on the page can show
 * in it; the page is the same, since the screenshot changes nothing. A screenshot of an element reads
 * its whole page. Under a soft `expect` the read's verdict is soft too, as the screenshot's is, so the
 * test goes on to its later screenshots and their reads.
 */
async function readAccessibility(subject: Page | Locator, name: unknown, soft: boolean): Promise<void> {
  const check = soft ? base.soft : base
  const state = stateOf(playwrightTest.info().file, name)
  if (typeof state === 'string') throw new Error(state)
  await playwrightTest.step(`axe reads ${state.spec}/${state.shot}`, async () => {
    base(BUDGETS, `budgets.accessibility in checks.json can't be read:\n${[BUDGETS].flat().join('\n')}`).not.toBeInstanceOf(Array)
    const page = 'page' in subject ? subject.page() : subject
    const found = await violations(page, (BUDGETS as Budgets).tags)
    if (typeof found === 'string') throw new Error(found)
    // Every element axe found, in the report CI uploads on a failure, for whoever fixes one.
    await playwrightTest.info().attach(`axe ${state.spec}/${state.shot}`, { contentType: 'application/json', body: JSON.stringify({ ...state, violations: found }) })
    const verdict = judge(state, found, BUDGETS as Budgets)
    check(verdict.passed, verdict.report).toBe(true)
  })
}

/**
 * An `expect` whose `toHaveScreenshot` also reads the state it shows with axe; so are those of the
 * `expect`s it makes (`expect.soft`, `expect.configure`, `expect.extend`), so no way of taking a
 * screenshot through it skips the read. `soft` says whether its assertions are soft.
 */
function reading(made: typeof base, soft = false): typeof base {
  return new Proxy(made, {
    apply(target, self, args: Parameters<typeof base>) {
      const matchers = Reflect.apply(target, self, args)
      return new Proxy(matchers, {
        get(object, key) {
          if (key !== 'toHaveScreenshot') return Reflect.get(object, key)
          return async (...screenshot: unknown[]) => {
            await (Reflect.get(object, key) as (...args: unknown[]) => Promise<void>)(...screenshot)
            await readAccessibility(args[0] as Page | Locator, screenshot[0], soft)
          }
        },
      })
    },
    get(target, key) {
      if (key === 'soft') return reading(target.soft, true)
      if (key === 'configure') {
        return (...options: Parameters<typeof base.configure>) => reading(target.configure(...options), options[0]?.soft ?? soft)
      }
      if (key === 'extend') return (...matchers: Parameters<typeof base.extend>) => reading(target.extend(...matchers) as typeof base, soft)
      return Reflect.get(target, key)
    },
  })
}

/** Playwright's `expect`, but for `toHaveScreenshot`, which also reads the state it shows with axe. */
export const expect = reading(base)

/**
 * Playwright's `test`, whose `test.expect` is the `expect` above rather than Playwright's own, as is
 * that of every `test` its `extend` makes.
 */
function withReading(made: typeof playwrightTest): typeof playwrightTest {
  return new Proxy(made, {
    get(target, key) {
      if (key === 'expect') return expect
      if (key === 'extend') return (...fixtures: Parameters<typeof playwrightTest.extend>) => withReading(target.extend(...fixtures) as typeof playwrightTest)
      return Reflect.get(target, key)
    },
  })
}

export const test = withReading(playwrightTest)
