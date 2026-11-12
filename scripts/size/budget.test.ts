import { describe, expect, it } from 'vitest'
import { counted, judge, kindOf, readBudgets, unchecked, type Budgets } from './budget.ts'

const BUDGETS: Budgets = { js: 1000, css: 100, rest: 500 }

describe('kindOf', () => {
  it.each([
    ['assets/index-Ab12.js', 'js'],
    ['sw.mjs', 'js'],
    ['assets/index-Ab12.css', 'css'],
    ['assets/font-Ab12.woff2', 'rest'],
    ['index.html', 'rest'],
    ['assets/index-Ab12.js.map', 'rest'],
    ['scripts.json', 'rest'],
    ['style.css.txt', 'rest'],
  ])('counts %s under %s', (path, kind) => {
    expect(kindOf(path)).toBe(kind)
  })
})

describe('counted', () => {
  it('counts JS and CSS gzipped and the rest as it is', () => {
    expect([counted('js'), counted('css'), counted('rest')]).toEqual(['gzipped', 'gzipped', 'as is'])
  })
})

describe('readBudgets', () => {
  it('reads a whole number of bytes for each kind', () => {
    expect(readBudgets({ coverage: {}, budgets: { size: { js: 1000, css: 100, rest: 500 } } })).toEqual(BUDGETS)
  })

  const allMissing = ['js', 'css', 'rest'].map((kind) => `\`budgets.size.${kind}\` in checks.json is missing`)

  it.each([
    ['no budgets at all', {}, allMissing],
    ['budgets that are not an object', { budgets: [1, 2, 3] }, allMissing],
    ['a checks file that is not an object', null, allMissing],
    ['one kind missing', { budgets: { size: { js: 1000, css: 100 } } }, ['`budgets.size.rest` in checks.json is missing']],
    ['a budget given as a string', { budgets: { size: { ...BUDGETS, js: '1000' } } }, ['`budgets.size.js` in checks.json is not a whole number of bytes above 0: `"1000"`']],
    ['a fraction', { budgets: { size: { ...BUDGETS, css: 100.5 } } }, ['`budgets.size.css` in checks.json is not a whole number of bytes above 0: `100.5`']],
    ['zero', { budgets: { size: { ...BUDGETS, rest: 0 } } }, ['`budgets.size.rest` in checks.json is not a whole number of bytes above 0: `0`']],
    ['a negative budget', { budgets: { size: { ...BUDGETS, rest: -1 } } }, ['`budgets.size.rest` in checks.json is not a whole number of bytes above 0: `-1`']],
    ['null', { budgets: { size: { ...BUDGETS, js: null } } }, ['`budgets.size.js` in checks.json is not a whole number of bytes above 0: `null`']],
  ])('says what is wrong with %s rather than passing it', (_name, checks, problems) => {
    expect(readBudgets(checks)).toEqual(problems)
  })

  it('takes a budget of one byte', () => {
    expect(readBudgets({ budgets: { size: { js: 1, css: 1, rest: 1 } } })).toEqual({ js: 1, css: 1, rest: 1 })
  })
})

describe('judge', () => {
  const files = [
    { path: 'assets/index-Ab12.js', size: 700 },
    { path: 'sw.js', size: 200 },
    { path: 'assets/index-Ab12.css', size: 90 },
    { path: 'assets/font-Ab12.woff2', size: 300 },
    { path: 'index.html', size: 50 },
  ]

  it('passes a build within every budget, with each kind summed in a table', () => {
    const { passed, report } = judge(files, BUDGETS)
    expect(passed).toBe(true)
    expect(report).toBe(
      [
        '## Build size',
        '',
        '| Kind | Size | Budget | Left |',
        '| --- | ---: | ---: | ---: |',
        '| JS, gzipped | 900 B | 1,000 B | 100 B |',
        '| CSS, gzipped | 90 B | 100 B | 10 B |',
        '| Everything else, as is | 350 B | 500 B | 150 B |',
      ].join('\n'),
    )
  })

  it('passes a kind exactly at its budget', () => {
    expect(judge([...files, { path: 'theme.js', size: 100 }], BUDGETS).passed).toBe(true)
  })

  it('fails a kind over its budget, saying by how much, its heaviest files and what to do', () => {
    const heavier = [...files, { path: 'theme.js', size: 101 }, { path: 'registerSW.js', size: 101 }, { path: 'assets/fonts-Ab12.css', size: 20 }]
    const { passed, report } = judge(heavier, BUDGETS)
    expect(passed).toBe(false)
    expect(report).toContain('| JS, gzipped | 1,102 B | 1,000 B | -102 B |')
    expect(report).toContain(
      '**JS is over its budget by 102 B**: 1,102 B gzipped against 1,000 B. Its heaviest files: `assets/index-Ab12.js` 700 B, `sw.js` 200 B, `registerSW.js` 101 B.',
    )
    expect(report).toContain('**CSS is over its budget by 10 B**: 110 B gzipped against 100 B. Its heaviest files: `assets/index-Ab12.css` 90 B, `assets/fonts-Ab12.css` 20 B.')
    expect(report).not.toContain('Everything else is over')
    expect(report).toMatch(/Find what grew: .* Raising a budget is the owner's decision, not a way to get a PR through/)
  })

  it('counts the rest as it is in a failure', () => {
    const { passed, report } = judge([...files, { path: 'icons/icon-512.png', size: 151 }], BUDGETS)
    expect(passed).toBe(false)
    expect(report).toContain('**Everything else is over its budget by 1 B**: 501 B as is against 500 B. Its heaviest files: `assets/font-Ab12.woff2` 300 B, `icons/icon-512.png` 151 B, `index.html` 50 B.')
  })

  const none = {
    js: '- the build has no JS file (`.js`, `.mjs`), which every build of the app has: run `npm run build` again',
    css: '- the build has no CSS file, which every build of the app has: run `npm run build` again',
    rest: '- the build has no other file (`index.html`, the fonts, the icons), which every build of the app has: run `npm run build` again',
  }

  it('fails a build with no files rather than passing it, naming each kind it lacks', () => {
    expect(judge([], BUDGETS)).toEqual({ passed: false, report: ["## Build size\n\nThe size couldn't be checked:\n", none.js, none.css, none.rest].join('\n') })
  })

  it.each([
    ['no CSS', files.filter(({ path }) => !path.endsWith('.css')), [none.css]],
    ['no JS', files.filter(({ path }) => !path.endsWith('.js')), [none.js]],
    ['nothing but JS and CSS', files.filter(({ path }) => /\.(js|css)$/.test(path)), [none.rest]],
    ['JS that kindOf reads as the rest', [...files.filter(({ path }) => !path.endsWith('.js')), { path: 'assets/index-Ab12.cjs', size: 700 }], [none.js]],
  ])('fails a build with %s as one it could not check, rather than a light one', (_name, built, lines) => {
    const { passed, report } = judge(built, { js: 1, css: 1, rest: 1 })
    expect(passed).toBe(false)
    expect(report.split('\n').filter((line) => line.startsWith('- '))).toEqual(lines)
  })
})

describe('unchecked', () => {
  it('fails, listing every problem', () => {
    expect(unchecked(['one', 'two'])).toEqual({ passed: false, report: "## Build size\n\nThe size couldn't be checked:\n\n- one\n- two" })
  })
})
