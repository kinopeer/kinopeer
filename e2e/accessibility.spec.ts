import { readdirSync } from 'node:fs'
import { stateOf, unmatched, type Budgets, type State } from '../scripts/accessibility/budget.ts'
import { BUDGETS, expect, test } from './test.ts'

// Each screenshot's test reads its own state against its budget (e2e/test.ts); what no single test
// can see is a budget whose screenshot is gone. The baselines name every screenshot the specs take,
// since one without a baseline fails, so the budgets are held to them.
test('every screenshot with a baseline has its accessibility budgets, and every budget a baseline', () => {
  expect(BUDGETS, `budgets.accessibility in checks.json can't be read:\n${[BUDGETS].flat().join('\n')}`).not.toBeInstanceOf(Array)
  const folder = new URL('./__screenshots__/', import.meta.url)
  const taken = readdirSync(folder).flatMap((spec) =>
    readdirSync(new URL(`${spec}/`, folder))
      .filter((file) => file.endsWith('.png'))
      .map((file) => stateOf(spec, file)),
  )
  expect(taken.filter((state) => typeof state === 'string')).toEqual([])
  expect(unmatched(BUDGETS as Budgets, taken as State[])).toEqual([])
})
