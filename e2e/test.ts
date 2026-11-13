import { readFileSync } from 'node:fs'
import { AxeBuilder } from '@axe-core/playwright'
import { expect as base, test, type Locator, type Page } from '@playwright/test'
import { judge, readBudgets, stateOf, type Budgets, type Violation } from '../scripts/accessibility/budget.ts'

/**
 * Playwright's `test` and `expect` for the screenshot tests, where every screenshot also has axe read
 * the state it shows against its budgets, `budgets.accessibility` in checks.json (docs/QUALITY.md →
 * The accessibility budget). The read is in `toHaveScreenshot` itself rather than a helper a spec
 * calls beside it, so a new screenshot can't be taken without it; oxlint refuses `test` and `expect`
 * from `@playwright/test` in the specs (.oxlintrc.json).
 */
export const BUDGETS = readBudgets(JSON.parse(readFileSync(new URL('../checks.json', import.meta.url), 'utf8')))

/** What axe finds broken on the page, by the tags checks.json names, as the budget's rules take it. */
async function violations(page: Page, tags: string[]): Promise<Violation[]> {
  const results = await new AxeBuilder({ page }).withTags(tags).analyze()
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
 * its whole page.
 */
async function readAccessibility(subject: Page | Locator, name: unknown): Promise<void> {
  const state = stateOf(test.info().file, name)
  if (typeof state === 'string') throw new Error(state)
  await test.step(`axe reads ${state.spec}/${state.shot}`, async () => {
    base(BUDGETS, `budgets.accessibility in checks.json can't be read:\n${[BUDGETS].flat().join('\n')}`).not.toBeInstanceOf(Array)
    const page = 'page' in subject ? subject.page() : subject
    const found = await violations(page, (BUDGETS as Budgets).tags)
    // Every element axe found, in the report CI uploads on a failure, for whoever fixes one.
    await test.info().attach(`axe ${state.spec}/${state.shot}`, { contentType: 'application/json', body: JSON.stringify({ ...state, violations: found }) })
    const verdict = judge(state, found, BUDGETS as Budgets)
    base(verdict.passed, verdict.report).toBe(true)
  })
}

/**
 * An `expect` whose `toHaveScreenshot` also reads the state it shows with axe; so are those of the
 * `expect`s it makes (`expect.soft`, `expect.configure`), so no way of taking a screenshot skips it.
 */
function reading(made: typeof base): typeof base {
  return new Proxy(made, {
    apply(target, self, args: Parameters<typeof base>) {
      const matchers = Reflect.apply(target, self, args)
      return new Proxy(matchers, {
        get(object, key) {
          if (key !== 'toHaveScreenshot') return Reflect.get(object, key)
          return async (...screenshot: unknown[]) => {
            await (Reflect.get(object, key) as (...args: unknown[]) => Promise<void>)(...screenshot)
            await readAccessibility(args[0] as Page | Locator, screenshot[0])
          }
        },
      })
    },
    get(target, key) {
      if (key === 'soft') return reading(target.soft)
      if (key === 'configure') return (...options: Parameters<typeof base.configure>) => reading(target.configure(...options))
      return Reflect.get(target, key)
    },
  })
}

/** Playwright's `expect`, but for `toHaveScreenshot`, which also reads the state it shows with axe. */
export const expect = reading(base)

export { test }
