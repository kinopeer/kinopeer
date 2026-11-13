import { describe, expect, it } from 'vitest'
import { LISTED, counts, judge, readBudgets, stateOf, unmatched, type Budgets, type Violation } from './budget.ts'

const TAGS = ['wcag2a', 'wcag2aa']
const BUDGETS: Budgets = { tags: TAGS, states: { downloads: { 'list-dark-ru': { 'color-contrast': 2 }, 'empty-dark-ru': {} } } }

/** checks.json with these accessibility budgets and tags. */
const checks = (accessibility: unknown, tags: unknown = TAGS) => ({ budgets: { size: {}, accessibilityTags: tags, accessibility } })

const node = (index: number) => ({ target: `.row:nth-child(${index})`, html: `<span class="c3">${index}</span>` })
const violation = (id: string, count: number): Violation => ({
  id,
  help: `${id} help`,
  helpUrl: `https://example.org/rules/${id}`,
  nodes: Array.from({ length: count }, (_, index) => node(index + 1)),
})

describe('readBudgets', () => {
  it('reads the tags and a whole number of elements for each rule of each screenshot of each spec', () => {
    expect(readBudgets(checks(BUDGETS.states))).toEqual(BUDGETS)
  })

  it.each([
    ['no budgets at all', {}, ['`budgets.accessibilityTags` in checks.json is missing', '`budgets.accessibility` in checks.json is missing']],
    ['a checks file that is not an object', null, ['`budgets.accessibilityTags` in checks.json is missing', '`budgets.accessibility` in checks.json is missing']],
    ['specs that are not an object', checks([]), ['`budgets.accessibility` in checks.json is not an object of specs']],
    ['a spec that is not an object of screenshots', checks({ downloads: 1 }), ['`budgets.accessibility["downloads"]` is not an object of screenshots']],
    ['a spec given as null', checks({ downloads: null }), ['`budgets.accessibility["downloads"]` is not an object of screenshots']],
    ['a screenshot that is not an object of rules', checks({ downloads: { list: [] } }), ['`budgets.accessibility["downloads"]["list"]` is not an object of axe\'s rules']],
    ['a budget given as a string', checks({ downloads: { list: { 'color-contrast': '2' } } }), ['`budgets.accessibility["downloads"]["list"]["color-contrast"]` is not a whole number of elements, 0 or more: `"2"`']],
    ['a budget below 0', checks({ downloads: { list: { 'color-contrast': -1 } } }), ['`budgets.accessibility["downloads"]["list"]["color-contrast"]` is not a whole number of elements, 0 or more: `-1`']],
    ['a budget that is not whole', checks({ downloads: { list: { 'color-contrast': 1.5 } } }), ['`budgets.accessibility["downloads"]["list"]["color-contrast"]` is not a whole number of elements, 0 or more: `1.5`']],
    ['a budget JSON reads as Infinity', JSON.parse('{ "budgets": { "accessibilityTags": ["wcag2a"], "accessibility": { "downloads": { "list": { "color-contrast": 1e999 } } } } }'), ['`budgets.accessibility["downloads"]["list"]["color-contrast"]` is not a whole number of elements, 0 or more: `null`']],
  ])('names what is wrong: %s', (_, checks, problems) => {
    expect(readBudgets(checks)).toEqual(problems)
  })

  it('takes a budget of 0, which a fix lowers a budget to rather than removing it', () => {
    expect(readBudgets(checks({ downloads: { list: { 'color-contrast': 0 } } }))).toEqual({ tags: TAGS, states: { downloads: { list: { 'color-contrast': 0 } } } })
  })

  it.each([
    ['a spec', { 'downloads.spec': { list: {} } }, '`budgets.accessibility["downloads.spec"]`'],
    ['a screenshot', { downloads: { 'list.png': {} } }, '`budgets.accessibility["downloads"]["list.png"]`'],
    ['a rule', { downloads: { list: { 'color.contrast': 1 } } }, '`budgets.accessibility["downloads"]["list"]["color.contrast"]`'],
    ['an empty one', { downloads: { '': {} } }, '`budgets.accessibility["downloads"][""]`'],
  ])('refuses a key the checks guard can\'t read, with a dot or empty: %s', (_, states, path) => {
    expect(readBudgets(checks(states))).toEqual([`${path} has a key the checks guard can't read, empty or with a dot in it`])
  })

  it.each([
    ['missing', undefined, '`budgets.accessibilityTags` in checks.json is missing'],
    ['empty', [], '`budgets.accessibilityTags` is not a list of axe\'s tags: `[]`'],
    ['not a list', 'wcag2a', '`budgets.accessibilityTags` is not a list of axe\'s tags: `"wcag2a"`'],
    ['with a tag that is not a string', ['wcag2a', 2], '`budgets.accessibilityTags` is not a list of axe\'s tags: `["wcag2a",2]`'],
    ['with an empty tag', ['wcag2a', ''], '`budgets.accessibilityTags` is not a list of axe\'s tags: `["wcag2a",""]`'],
  ])('refuses tags %s, and still checks the budgets', (_, tags, problem) => {
    expect(readBudgets({ budgets: { accessibilityTags: tags, accessibility: { downloads: { list: { 'color-contrast': 'x' } } } } })).toEqual([
      problem,
      '`budgets.accessibility["downloads"]["list"]["color-contrast"]` is not a whole number of elements, 0 or more: `"x"`',
    ])
  })

  it('names every problem, each spec and screenshot on its own', () => {
    expect(readBudgets(checks({ downloads: { list: { a: '1', b: 1 }, grid: null }, search: 2 }))).toEqual([
      '`budgets.accessibility["downloads"]["list"]["a"]` is not a whole number of elements, 0 or more: `"1"`',
      '`budgets.accessibility["downloads"]["grid"]` is not an object of axe\'s rules',
      '`budgets.accessibility["search"]` is not an object of screenshots',
    ])
  })
})

describe('stateOf', () => {
  it('names the state by the spec without .spec.ts and the screenshot without .png', () => {
    expect(stateOf('/work/e2e/downloads.spec.ts', 'list-dark-ru.png')).toEqual({ spec: 'downloads', shot: 'list-dark-ru' })
    expect(stateOf('downloads.spec.ts', 'list-dark-ru.png')).toEqual({ spec: 'downloads', shot: 'list-dark-ru' })
    expect(stateOf('C:\\work\\e2e\\search.spec.ts', 'browse.png')).toEqual({ spec: 'search', shot: 'browse' })
  })

  it('refuses a screenshot without a name, which would have no key', () => {
    expect(stateOf('/work/e2e/downloads.spec.ts', { mask: [] })).toBe('A screenshot in downloads.spec.ts has no name: name it, so its accessibility budget has a key')
    expect(stateOf('/work/e2e/downloads.spec.ts', undefined)).toBe('A screenshot in downloads.spec.ts has no name: name it, so its accessibility budget has a key')
  })

  it.each([
    ['not a PNG', 'list.jpeg'],
    ['another dot in it', 'list.v2.png'],
    ['nothing before .png', '.png'],
  ])('refuses a name with %s, which the checks guard couldn\'t read as a key', (_, name) => {
    expect(stateOf('/work/e2e/downloads.spec.ts', name)).toBe(
      `The screenshot ${name} in downloads.spec.ts needs a name ending in .png with no other dot, in a spec whose name has none but its .spec.ts, so its accessibility budget has a key the checks guard can read`,
    )
  })

  it('refuses a file that is not a spec, whose name keeps its dots', () => {
    expect(stateOf('/work/e2e/downloads.spec.tsx', 'list.png')).toBe(
      'The screenshot list.png in downloads.spec.tsx needs a name ending in .png with no other dot, in a spec whose name has none but its .spec.ts, so its accessibility budget has a key the checks guard can read',
    )
  })

  it('refuses a spec whose name has a dot in it', () => {
    expect(stateOf('/work/e2e/downloads.v2.spec.ts', 'list.png')).toBe(
      'The screenshot list.png in downloads.v2.spec.ts needs a name ending in .png with no other dot, in a spec whose name has none but its .spec.ts, so its accessibility budget has a key the checks guard can read',
    )
  })
})

describe('counts', () => {
  it('counts the elements that break each rule', () => {
    expect(counts([violation('color-contrast', 3), violation('target-size', 1)])).toEqual({ 'color-contrast': 3, 'target-size': 1 })
    expect(counts([])).toEqual({})
  })
})

describe('judge', () => {
  const list = { spec: 'downloads', shot: 'list-dark-ru' }

  it('passes a state whose every rule breaks on exactly its budget of elements', () => {
    expect(judge(list, [violation('color-contrast', 2)], BUDGETS)).toEqual({ passed: true, report: '' })
  })

  it('passes a state with an empty budget where axe finds nothing', () => {
    expect(judge({ spec: 'downloads', shot: 'empty-dark-ru' }, [], BUDGETS)).toEqual({ passed: true, report: '' })
  })

  it('passes a rule budgeted at 0 that axe finds nothing for', () => {
    const budgets: Budgets = { tags: TAGS, states: { downloads: { 'list-dark-ru': { 'color-contrast': 0 } } } }
    expect(judge(list, [], budgets)).toEqual({ passed: true, report: '' })
  })

  it('fails a rule over its budget, naming the rule, the count, what it asks, its help link and the elements', () => {
    expect(judge(list, [violation('color-contrast', 3)], BUDGETS)).toEqual({
      passed: false,
      report: [
        'The downloads screenshot list-dark-ru isn\'t what its accessibility budgets say (`budgets.accessibility["downloads"]["list-dark-ru"]`):',
        '- color-contrast: 3, over its budget of 2 (color-contrast help, https://example.org/rules/color-contrast)',
        '    - .row:nth-child(1): <span class="c3">1</span>',
        '    - .row:nth-child(2): <span class="c3">2</span>',
        '    - .row:nth-child(3): <span class="c3">3</span>',
      ].join('\n'),
    })
  })

  it('fails a rule the state has no budget for, as a budget of 0', () => {
    expect(judge({ spec: 'downloads', shot: 'empty-dark-ru' }, [violation('target-size', 1)], BUDGETS)).toEqual({
      passed: false,
      report: [
        'The downloads screenshot empty-dark-ru isn\'t what its accessibility budgets say (`budgets.accessibility["downloads"]["empty-dark-ru"]`):',
        '- target-size: 1, over its budget of 0 (target-size help, https://example.org/rules/target-size)',
        '    - .row:nth-child(1): <span class="c3">1</span>',
      ].join('\n'),
    })
  })

  it('fails a rule under its budget, saying to lower it, since a budget left higher lets a broken element back in', () => {
    expect(judge(list, [violation('color-contrast', 1)], BUDGETS)).toEqual({
      passed: false,
      report: [
        'The downloads screenshot list-dark-ru isn\'t what its accessibility budgets say (`budgets.accessibility["downloads"]["list-dark-ru"]`):',
        '- color-contrast: 1, under its budget of 2: lower it to 1 in checks.json',
      ].join('\n'),
    })
    expect(judge(list, [], BUDGETS).report).toContain('- color-contrast: 0, under its budget of 2: lower it to 0 in checks.json')
  })

  it('names each rule off its budget, in the order of their names, and leaves out those on it', () => {
    const budgets: Budgets = { tags: TAGS, states: { downloads: { 'list-dark-ru': { 'target-size': 2, 'color-contrast': 1, region: 1 } } } }
    const lines = judge(list, [violation('region', 1), violation('target-size', 1), violation('color-contrast', 2)], budgets).report.split('\n')
    expect(lines.filter((line) => line.startsWith('- '))).toEqual([
      '- color-contrast: 2, over its budget of 1 (color-contrast help, https://example.org/rules/color-contrast)',
      '- target-size: 1, under its budget of 2: lower it to 1 in checks.json',
    ])
  })

  it(`lists a rule's first ${LISTED} elements and says how many more there are`, () => {
    const lines = judge(list, [violation('color-contrast', LISTED + 3)], BUDGETS).report.split('\n')
    expect(lines.filter((line) => line.startsWith('    - '))).toHaveLength(LISTED + 1)
    expect(lines.at(-2)).toBe(`    - .row:nth-child(${LISTED}): <span class="c3">${LISTED}</span>`)
    expect(lines.at(-1)).toBe('    - and 3 more')
  })

  it('lists all of exactly as many elements as it lists', () => {
    const lines = judge(list, [violation('color-contrast', LISTED)], BUDGETS).report.split('\n')
    expect(lines.at(-1)).toBe(`    - .row:nth-child(${LISTED}): <span class="c3">${LISTED}</span>`)
  })

  it("cuts an element's HTML after 120 characters", () => {
    const long: Violation = { ...violation('color-contrast', 0), nodes: [{ target: '.long', html: 'x'.repeat(121) }, { target: '.fits', html: 'y'.repeat(120) }] }
    const lines = judge({ spec: 'downloads', shot: 'empty-dark-ru' }, [long], BUDGETS).report.split('\n')
    expect(lines.at(-2)).toBe(`    - .long: ${'x'.repeat(120)}…`)
    expect(lines.at(-1)).toBe(`    - .fits: ${'y'.repeat(120)}`)
  })

  it('fails a state without a budget, giving what to add to checks.json and what axe found', () => {
    expect(judge({ spec: 'search', shot: 'browse-dark-ru' }, [violation('color-contrast', 1), violation('region', 2)], BUDGETS)).toEqual({
      passed: false,
      report: [
        '`budgets.accessibility["search"]["browse-dark-ru"]` is missing for a screenshot the tests take: add it to checks.json as `{"color-contrast":1,"region":2}`, what axe finds there.',
        '- color-contrast: 1 (color-contrast help, https://example.org/rules/color-contrast)',
        '    - .row:nth-child(1): <span class="c3">1</span>',
        '- region: 2 (region help, https://example.org/rules/region)',
        '    - .row:nth-child(1): <span class="c3">1</span>',
        '    - .row:nth-child(2): <span class="c3">2</span>',
      ].join('\n'),
    })
    expect(judge({ spec: 'downloads', shot: 'grid-dark-ru' }, [], BUDGETS)).toEqual({
      passed: false,
      report: '`budgets.accessibility["downloads"]["grid-dark-ru"]` is missing for a screenshot the tests take: add it to checks.json as `{}`, what axe finds there.',
    })
  })
})

describe('unmatched', () => {
  it('passes when every screenshot with a baseline has a budget and every budget a baseline', () => {
    expect(unmatched(BUDGETS, [{ spec: 'downloads', shot: 'empty-dark-ru' }, { spec: 'downloads', shot: 'list-dark-ru' }])).toEqual([])
  })

  it('names a budget for a screenshot with no baseline and a screenshot with a baseline but no budget', () => {
    expect(unmatched(BUDGETS, [{ spec: 'downloads', shot: 'list-dark-ru' }, { spec: 'search', shot: 'browse-dark-ru' }])).toEqual([
      '`budgets.accessibility["downloads"]["empty-dark-ru"]` is a budget for a screenshot with no baseline: take it out of checks.json',
      '`budgets.accessibility["search"]["browse-dark-ru"]` is missing for a screenshot with a baseline: add it to checks.json',
    ])
  })

  it('tells a screenshot apart from one of the same name in another spec', () => {
    expect(unmatched(BUDGETS, [{ spec: 'search', shot: 'list-dark-ru' }, { spec: 'downloads', shot: 'empty-dark-ru' }])).toEqual([
      '`budgets.accessibility["downloads"]["list-dark-ru"]` is a budget for a screenshot with no baseline: take it out of checks.json',
      '`budgets.accessibility["search"]["list-dark-ru"]` is missing for a screenshot with a baseline: add it to checks.json',
    ])
  })
})
