import { describe, expect, it } from 'vitest'
import { judge, readBudgets, table, total, uncased, unmatched, type Budgets, type Shift } from './budget.ts'

const BUDGETS: Budgets = { phone: { torrent: 0.1, downloads: 0 } }
const shift = (value: number, afterInput = false): Shift => ({ value, sources: [`div.moved 0/100 → ${value * 1000}/100`], afterInput })

/** checks.json with these layout shift budgets and the ceiling over them. */
const checks = (layoutShift: unknown, ceiling: unknown = 0.1) => ({ budgets: { size: {}, layoutShiftCeiling: ceiling, layoutShift } })

describe('readBudgets', () => {
  it('reads a score of 0 or more for each screen of each window size', () => {
    expect(readBudgets(checks({ phone: { torrent: 0.1, downloads: 0 } }))).toEqual(BUDGETS)
  })

  it.each([
    ['no budgets at all', {}, ['`budgets.layoutShiftCeiling` in checks.json is missing', '`budgets.layoutShift` in checks.json is missing']],
    ['a checks file that is not an object', null, ['`budgets.layoutShiftCeiling` in checks.json is missing', '`budgets.layoutShift` in checks.json is missing']],
    ['window sizes that are not an object', checks([0.1]), ['`budgets.layoutShift` in checks.json is not an object of window sizes']],
    ['a size that is not an object of screens', checks({ phone: 0.1 }), ['`budgets.layoutShift["phone"]` is not an object of screens']],
    ['a size given as null', checks({ phone: null }), ['`budgets.layoutShift["phone"]` is not an object of screens']],
    ['a budget given as a string', checks({ phone: { torrent: '0.1' } }), ['`budgets.layoutShift["phone"]["torrent"]` is not a layout shift of 0 or more: `"0.1"`']],
    ['a budget below 0', checks({ phone: { torrent: -0.1 } }), ['`budgets.layoutShift["phone"]["torrent"]` is not a layout shift of 0 or more: `-0.1`']],
    ['a budget JSON reads as Infinity', JSON.parse('{ "budgets": { "layoutShiftCeiling": 0.1, "layoutShift": { "phone": { "torrent": 1e999 } } } }'), ['`budgets.layoutShift["phone"]["torrent"]` is not a layout shift of 0 or more: `Infinity`']],
  ])('names what is wrong: %s', (_, checks, problems) => {
    expect(readBudgets(checks)).toEqual(problems)
  })

  it.each([
    ['missing', undefined, '`budgets.layoutShiftCeiling` in checks.json is missing'],
    ['given as a string', '0.1', '`budgets.layoutShiftCeiling` is not a layout shift over 0: `"0.1"`'],
    ['0', 0, '`budgets.layoutShiftCeiling` is not a layout shift over 0: `0`'],
    ['below 0', -0.1, '`budgets.layoutShiftCeiling` is not a layout shift over 0: `-0.1`'],
    ['read as Infinity', Infinity, '`budgets.layoutShiftCeiling` is not a layout shift over 0: `Infinity`'],
  ])('refuses a ceiling %s, and checks the budgets against none', (_, ceiling, problem) => {
    expect(readBudgets({ budgets: { layoutShiftCeiling: ceiling, layoutShift: { phone: { torrent: 0.5, title: 'x' } } } })).toEqual([
      problem,
      '`budgets.layoutShift["phone"]["title"]` is not a layout shift of 0 or more: `"x"`',
    ])
  })

  it('takes a budget of exactly the ceiling', () => {
    expect(readBudgets(checks({ phone: { torrent: 0.05 } }, 0.05))).toEqual({ phone: { torrent: 0.05 } })
  })

  it('refuses a budget over the ceiling checks.json gives, saying what the ceiling is', () => {
    expect(readBudgets(checks({ phone: { torrent: 0.0501, title: 0.05 } }, 0.05))).toEqual([
      '`budgets.layoutShift["phone"]["torrent"]` is 0.0501, over the ceiling of 0.05 (`budgets.layoutShiftCeiling`): a screen that moves more has a bug to fix, not a budget to raise',
    ])
  })

  it('names every problem, each size and screen on its own', () => {
    expect(readBudgets(checks({ phone: { torrent: '1', title: 0.1 }, desktop: [], tablet: { torrent: null } }))).toEqual([
      '`budgets.layoutShift["phone"]["torrent"]` is not a layout shift of 0 or more: `"1"`',
      '`budgets.layoutShift["desktop"]` is not an object of screens',
      '`budgets.layoutShift["tablet"]["torrent"]` is not a layout shift of 0 or more: `null`',
    ])
  })
})

describe('total', () => {
  it('sums every shift, those after input too', () => {
    expect(total([shift(0.25), shift(0.125, true), shift(0.0625)])).toBe(0.4375)
  })

  it('is 0 for a load that moved nothing', () => {
    expect(total([])).toBe(0)
  })
})

describe('judge', () => {
  it('passes a load that moved by exactly its budget', () => {
    expect(judge({ size: 'phone', screen: 'torrent' }, [shift(0.0625), shift(0.0375)], BUDGETS)).toEqual({ passed: true, total: 0.1, report: '' })
  })

  it('passes a screen whose budget is 0 when nothing moved', () => {
    expect(judge({ size: 'phone', screen: 'downloads' }, [], BUDGETS)).toEqual({ passed: true, total: 0, report: '' })
  })

  it('fails a load over its budget and lists every shift with what moved, after input marked', () => {
    const verdict = judge({ size: 'phone', screen: 'torrent' }, [shift(0.0625), shift(0.0625, true)], BUDGETS)
    expect(verdict).toEqual({
      passed: false,
      total: 0.125,
      report: [
        'The torrent screen (phone) moved by 0.1250 as it loaded, over its budget of 0.1 (`budgets.layoutShift["phone"]["torrent"]`):',
        '- 0.0625: div.moved 0/100 → 62.5/100',
        '- 0.0625 (after input): div.moved 0/100 → 62.5/100',
      ].join('\n'),
    })
  })

  it('fails a screen with no budget for its window size, saying where to add one', () => {
    expect(judge({ size: 'desktop', screen: 'torrent' }, [], BUDGETS)).toEqual({
      passed: false,
      total: 0,
      report: '`budgets.layoutShift["desktop"]["torrent"]` is missing for a screen the test opens: add it to checks.json',
    })
  })
})

describe('unmatched', () => {
  const budgets: Budgets = { phone: { torrent: 0.01, downloads: 0.01 } }

  it('finds nothing when every screen read has a budget and every budget a screen', () => {
    expect(unmatched(budgets, [{ size: 'phone', screen: 'torrent' }, { size: 'phone', screen: 'downloads' }])).toEqual([])
  })

  it('names a screen read without a budget', () => {
    expect(unmatched(budgets, [{ size: 'phone', screen: 'torrent' }, { size: 'phone', screen: 'downloads' }, { size: 'phone', screen: 'title' }])).toEqual([
      '`budgets.layoutShift["phone"]["title"]` is missing for a screen the test reads: add it to checks.json',
    ])
  })

  it('names a budget for a screen not read, in a size read or another', () => {
    expect(unmatched({ ...budgets, desktop: { torrent: 0.01 } }, [{ size: 'phone', screen: 'torrent' }])).toEqual([
      '`budgets.layoutShift["phone"]["downloads"]` is a budget for a screen the test doesn\'t read: take it out of checks.json, or give the screen a case in layoutShift.perf.ts',
      '`budgets.layoutShift["desktop"]["torrent"]` is a budget for a screen the test doesn\'t read: take it out of checks.json, or give the screen a case in layoutShift.perf.ts',
    ])
  })
})

describe('uncased', () => {
  it('finds nothing when every screen listed has a case, some more than one', () => {
    expect(uncased(['torrent', 'downloads'], ['torrent', 'torrent', 'downloads'])).toEqual([])
  })

  it('names a screen listed without a case, and a case of a screen not listed, once', () => {
    expect(uncased(['torrent', 'downloads'], ['torrent', 'search', 'search'])).toEqual([
      'The downloads screen has no case in layoutShift.perf.ts: give it one with its chain of answers',
      "A case reads the search screen, which e2e/performance/screens.ts doesn't list",
    ])
  })
})

describe('table', () => {
  it('lists each load with its screen\'s budget, to four digits', () => {
    expect(
      table(
        [
          { size: 'phone', screen: 'torrent', name: 'tagged', order: 'first', total: 0.00119 },
          { size: 'phone', screen: 'title', name: 'a movie', order: 'last', total: 0.0877 },
        ],
        { phone: { torrent: 0.01 } },
      ),
    ).toBe(
      [
        '### Layout shift',
        '',
        '| Size | Screen | Case | Order | Layout shift | Budget |',
        '| --- | --- | --- | --- | --- | --- |',
        '| phone | torrent | tagged | first | 0.0012 | 0.01 |',
        '| phone | title | a movie | last | 0.0877 | none |',
      ].join('\n'),
    )
  })
})
