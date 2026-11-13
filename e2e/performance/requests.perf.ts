// What each screen asks the servers for when it opens (docs/QUALITY.md → The requests budget): the
// built app, every server route mocked as in the screenshot tests, each screen of screens.ts loaded
// afresh by its address in both window sizes, its requests counted by route and compared with
// `budgets.requests` in checks.json. The rules are in scripts/requests/budget.ts; this file only collects the numbers.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { judge, countsOf, grouped, readBudgets, unmatched, type App, type Budgets, type Opened, type Sent } from '../../scripts/requests/budget.ts'
import { prepareApp } from '../app.ts'
import { builtPaths, holdForCounting, record, runClock, RUN_MS, SIZES, TORRENTS } from './page.ts'
import { SCREENS } from './screens.ts'

const BUDGETS = readBudgets(JSON.parse(readFileSync(new URL('../../checks.json', import.meta.url), 'utf8')))

/**
 * Opens `path` afresh with the clock paused, runs it `run` ms and returns the list of every request the
 * page sends, which keeps growing while the test checks the screen, so the counts are read after it.
 */
async function open(page: Page, path: string, run: number): Promise<Sent[]> {
  const { inFlight, sending } = record(page)
  await holdForCounting(page)
  await prepareApp(page, { torrents: TORRENTS })
  await page.goto(path)
  await runClock(page, inFlight, run)
  return sending()
}

test('the poll intervals give the clock a time to run for', () => {
  expect(RUN_MS, `src/torrents/pollIntervals.ts can't be read:\n${[RUN_MS].flat().join('\n')}`).not.toBeInstanceOf(Array)
})

test('every budget is for a screen the test opens, and every screen it opens has one', () => {
  const budgets = BUDGETS as Budgets
  expect(BUDGETS, 'budgets.requests in checks.json').not.toBeInstanceOf(Array)
  const opened: Opened[] = SIZES.flatMap(({ size }) => SCREENS.map(({ screen }) => ({ size, screen })))
  expect(unmatched(budgets, opened)).toEqual([])
})

for (const { size, use } of SIZES) {
  test.describe(size, () => {
    test.use(use)
    for (const { screen, path, heading, desktop, loaded } of SCREENS) {
      test(screen, async ({ page, baseURL }, testInfo) => {
        expect(RUN_MS, `src/torrents/pollIntervals.ts can't be read:\n${[RUN_MS].flat().join('\n')}`).not.toBeInstanceOf(Array)
        const sent = await open(page, path, RUN_MS as number)
        // The screen itself opened: its own heading, not a crash or another screen; and where that
        // heading stays above a "not answering" or empty state, what only its loaded content has.
        // Elsewhere the heading comes with what the screen loads, or the screen asks the same
        // whatever the services answer (Settings), as docs/QUALITY.md says.
        const { level, name } = size === 'desktop' && desktop ? desktop : heading
        await expect(page.getByRole('heading', { level, name, exact: true })).toBeVisible()
        if (loaded) await expect(page.getByRole(loaded.role, { name: loaded.name }).first()).toBeVisible()
        const app: App = { origin: new URL(baseURL!).origin, files: builtPaths() }
        await testInfo.attach('requests', {
          contentType: 'application/json',
          body: JSON.stringify({ size, screen, counts: countsOf(grouped(sent, app)) }),
        })
        expect(BUDGETS, `budgets.requests in checks.json can't be read:\n${[BUDGETS].flat().join('\n')}`).not.toBeInstanceOf(Array)
        const { passed, report } = judge({ size, screen, path }, sent, app, BUDGETS as Budgets)
        expect(passed, report).toBe(true)
      })
    }
  })
}
