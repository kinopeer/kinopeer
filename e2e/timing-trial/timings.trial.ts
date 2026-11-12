// A one-off trial for #378, not a check: how far time-based speed metrics move between runs of the
// same commit. Each screen loaded afresh (a new browser context per load) in three regimes, as the
// machine is, with the CPU slowed four times, and with 100 ms of synchronous work planted at the
// start of the page; what is measured and how is in measure.ts. scripts/timing-trial/aggregate.mjs
// reads the lines.
import { expect, test } from '@playwright/test'
import { prepareApp } from '../app.ts'
import { machine, measureMove, measureScreen, MOVES, PLANTED_MS, REGIMES, SCREENS, SIZES, TORRENTS, write, type Load, type Regime } from './measure.ts'

const REPEATS = Number(process.env.TRIAL_REPEATS ?? 5)
const LOADS: Record<Regime, Load> = { clean: { cpu4x: false, plantMs: 0 }, cpu4x: { cpu4x: true, plantMs: 0 }, planted: { cpu4x: false, plantMs: PLANTED_MS } }

// The machine, and one load of Downloads not recorded, so the first recorded load doesn't also pay
// for the preview server's and the browser's first start.
test('the machine', async ({ browser, page }) => {
  await prepareApp(page, { torrents: TORRENTS })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  write(machine(browser.version(), { repeats: REPEATS }))
})

// Repeats outermost, so each regime's runs spread over the job's whole time rather than one stretch of it.
for (let repeat = 1; repeat <= REPEATS; repeat++) {
  for (const { size, use } of SIZES) {
    test.describe(`${repeat} ${size}`, () => {
      test.use(use)
      const desktop = size === 'desktop'
      for (const regime of REGIMES) {
        for (const screen of SCREENS) {
          test(`${regime} ${screen.screen}`, async ({ page }) => {
            const base = { kind: 'screen', repeat, size, regime, name: screen.screen }
            try {
              write({ ...base, ...(await measureScreen(page, screen, desktop, LOADS[regime])) })
            } catch (error) {
              write({ ...base, error: String(error).slice(0, 500) })
              throw error
            }
          })
        }
        for (const move of MOVES) {
          test(`${regime} move ${move.move}`, async ({ page }) => {
            const base = { kind: 'move', repeat, size, regime, name: move.move }
            try {
              write({ ...base, ...(await measureMove(page, move, desktop, LOADS[regime])) })
            } catch (error) {
              write({ ...base, error: String(error).slice(0, 500) })
              throw error
            }
          })
        }
      }
    })
  }
}
