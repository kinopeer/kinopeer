// A second one-off trial for #378, not a check: timings measured as a pair, a base and a head in the
// same job on the same runner, to see whether the runner's speed cancels out of their ratio. One
// build, four arms: `base` and `head` as they are (the same code), `head+30` and `head+100` with that
// many ms of synchronous work planted as measure.ts plants it (a task queued at the page's start for
// a screen, the input's own handler for a move). The arms take turns load by load (base, head, +30,
// +100), their order rotating each round, so drift in the runner falls on all four alike. Round 0 is
// a warm-up of every screen and move in the base arm, recorded but not read. As the runner is: no CPU
// throttling. scripts/timing-trial/paired.mjs reads the lines.
import { expect, test } from '@playwright/test'
import { prepareApp } from '../app.ts'
import { machine, measureMove, measureScreen, MOVES, SCREENS, SIZES, TORRENTS, write } from './measure.ts'

const ROUNDS = Number(process.env.TRIAL_ROUNDS ?? 5)
const ARMS = [
  { arm: 'base', plantMs: 0 },
  { arm: 'head', plantMs: 0 },
  { arm: 'head+30', plantMs: 30 },
  { arm: 'head+100', plantMs: 100 },
]
/** Round r's order: the arms rotated by r, so no arm always comes first after another item's last. */
const armsOf = (round: number) => (round === 0 ? [ARMS[0]] : ARMS.map((_, at) => ARMS[(at + round - 1) % ARMS.length]))

test('the machine', async ({ browser, page }) => {
  await prepareApp(page, { torrents: TORRENTS })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  write(machine(browser.version(), { trial: 'paired', rounds: ROUNDS }))
})

for (let round = 0; round <= ROUNDS; round++) {
  for (const { size, use } of SIZES) {
    test.describe(`${round} ${size}`, () => {
      test.use(use)
      const desktop = size === 'desktop'
      for (const screen of SCREENS) {
        for (const { arm, plantMs } of armsOf(round)) {
          test(`${screen.screen} ${arm}`, async ({ page }) => {
            const base = { kind: 'screen', round, size, arm, name: screen.screen }
            try {
              write({ ...base, ...(await measureScreen(page, screen, desktop, { cpu4x: false, plantMs })) })
            } catch (error) {
              write({ ...base, error: String(error).slice(0, 500) })
              throw error
            }
          })
        }
      }
      for (const move of MOVES) {
        for (const { arm, plantMs } of armsOf(round)) {
          test(`move ${move.move} ${arm}`, async ({ page }) => {
            const base = { kind: 'move', round, size, arm, name: move.move }
            try {
              write({ ...base, ...(await measureMove(page, move, desktop, { cpu4x: false, plantMs })) })
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
