import { describe, expect, it } from 'vitest'
import { clockRun, clockShare, countsOf, grouped, JOURNEYS, judge, keyOf, readBudgets, table, unmatched, type App, type Budgets, type Counts, type Sent } from './budget.ts'

const ORIGIN = 'http://localhost:4174'
/** The app as the test sees it: its origin and what its build has. */
const APP: App = { origin: ORIGIN, files: new Set(['/index.html', '/theme.js', '/version.json', '/assets/index-Ab12.js']) }
const NONE: Counts = { '/qbt': 0, '/tmdb': 0, '/tmdb-img': 0, '/prowlarr': 0, '/api': 0, 'other paths': 0, 'other origins': 0 }
const DOWNLOADS: Counts = { ...NONE, '/qbt': 2, '/api': 1 }
const BUDGETS: Budgets = { phone: { downloads: DOWNLOADS, settings: NONE }, desktop: { downloads: DOWNLOADS } }
const get = (path: string, method = 'GET'): Sent => ({ method, url: `${ORIGIN}${path}` })
/** What the downloads screen sends within its budget: the page, a script, the session check, the poll and the settings. */
const WITHIN = [{ ...get('/'), document: true }, get('/assets/index-Ab12.js'), get('/qbt/api/v2/app/version'), get('/qbt/api/v2/sync/maindata?rid=0'), get('/api/settings')]
const DOWNLOADS_SCREEN = { size: 'phone', screen: 'downloads', path: '/' }

describe('keyOf', () => {
  it.each([
    ['/qbt/api/v2/sync/maindata?rid=0', '/qbt'],
    ['/tmdb/movie/693134?language=ru-RU', '/tmdb'],
    ['/tmdb-img/w342/movie-693134.svg', '/tmdb-img'],
    ['/prowlarr/search?query=Dune', '/prowlarr'],
    ['/api/settings', '/api'],
    ['/api', '/api'],
  ])('counts %s against %s', (path, key) => {
    expect(keyOf(get(path), APP)).toBe(key)
  })

  it.each([
    ['the page, at its address', { ...get('/title/movie/693134'), document: true }],
    ['a script the build has', get('/assets/index-Ab12.js')],
    ['a file the build has in its root', get('/version.json')],
    ['a file the build has, asked with a query', get('/theme.js?v=2')],
  ])("doesn't count %s", (_what, request) => {
    expect(keyOf(request, APP)).toBeNull()
  })

  it.each([
    ['a server route the routes leave out', '/healthz'],
    ['a path that only starts with a route', '/apiary.png'],
    ['a path that only starts with a route, followed by a dash', '/tmdb-other/x'],
    ['a file the build lacks', '/assets/index-Zz99.js'],
    ["the app's address fetched rather than loaded as the page", '/title/movie/693134'],
  ])('counts %s against other paths', (_what, path) => {
    expect(keyOf(get(path), APP)).toBe('other paths')
  })

  it.each([
    ['another host', 'https://fonts.example.com/onest.woff2'],
    ["another port of the app's host", 'http://localhost:4173/qbt/api/v2/app/version'],
    ['another scheme of the same host', 'https://localhost:4174/api/settings'],
    ['another host, with a path the build has', 'https://example.org/theme.js'],
  ])('counts a request to %s against other origins', (_what, url) => {
    expect(keyOf({ method: 'GET', url }, APP)).toBe('other origins')
  })

  it.each(['data:image/png;base64,AAAA', 'blob:http://localhost:4174/1b2c'])("doesn't count %s, which isn't fetched", (url) => {
    expect(keyOf({ method: 'GET', url }, APP)).toBeNull()
  })
})

describe('grouped and countsOf', () => {
  it('keeps each key its requests in the order sent, and counts them', () => {
    const byKey = grouped([...WITHIN, get('/qbt/api/v2/torrents/categories'), get('/healthz'), { method: 'GET', url: 'https://example.org/x' }], APP)
    expect(byKey['/qbt']).toEqual([get('/qbt/api/v2/app/version'), get('/qbt/api/v2/sync/maindata?rid=0'), get('/qbt/api/v2/torrents/categories')])
    expect(countsOf(byKey)).toEqual({ ...NONE, '/qbt': 3, '/api': 1, 'other paths': 1, 'other origins': 1 })
  })
})

describe('readBudgets', () => {
  it('reads every screen of every window size, a budget of 0 included', () => {
    expect(readBudgets({ coverage: {}, budgets: { size: {}, requests: BUDGETS } })).toEqual(BUDGETS)
  })

  it.each([
    ['no budgets at all', {}, ['`budgets.requests` in checks.json is missing']],
    ['a checks file that is not an object', null, ['`budgets.requests` in checks.json is missing']],
    ['budgets that are a list', { budgets: [{ requests: BUDGETS }] }, ['`budgets.requests` in checks.json is missing']],
    ['requests that are a list', { budgets: { requests: [BUDGETS] } }, ['`budgets.requests` in checks.json is not an object of window sizes']],
    ['requests set to null', { budgets: { requests: null } }, ['`budgets.requests` in checks.json is not an object of window sizes']],
    ['a window size that is not an object', { budgets: { requests: { ...BUDGETS, tablet: 3 } } }, ['`budgets.requests["tablet"]` is not an object of screens']],
    ['a screen that is a list', { budgets: { requests: { phone: { downloads: [1, 2] } } } }, ['`budgets.requests["phone"]["downloads"]` is not an object of routes']],
    ['a route missing', { budgets: { requests: { phone: { downloads: { ...NONE, '/api': undefined } } } } }, ['`budgets.requests["phone"]["downloads"]["/api"]` is missing']],
    [
      'a route given as a string',
      { budgets: { requests: { phone: { downloads: { ...NONE, '/qbt': '2' } } } } },
      ['`budgets.requests["phone"]["downloads"]["/qbt"]` is not a whole number of requests, 0 or more: `"2"`'],
    ],
    [
      'a fraction',
      { budgets: { requests: { phone: { downloads: { ...NONE, '/tmdb': 1.5 } } } } },
      ['`budgets.requests["phone"]["downloads"]["/tmdb"]` is not a whole number of requests, 0 or more: `1.5`'],
    ],
    [
      'a negative count',
      { budgets: { requests: { phone: { downloads: { ...NONE, 'other origins': -1 } } } } },
      ['`budgets.requests["phone"]["downloads"]["other origins"]` is not a whole number of requests, 0 or more: `-1`'],
    ],
    [
      'a route the check does not count',
      { budgets: { requests: { phone: { downloads: { ...NONE, '/healthz': 0 } } } } },
      ['`budgets.requests["phone"]["downloads"]["/healthz"]` is no route the check counts (`/qbt`, `/tmdb`, `/tmdb-img`, `/prowlarr`, `/api`, `other paths`, `other origins`)'],
    ],
  ])('says what is wrong with %s rather than passing it', (_what, checks, problems) => {
    expect(readBudgets(checks)).toEqual(problems)
  })

  it("reads a journey's moves from budgets.journeys, not the screens' budgets", () => {
    const moves: Budgets = { phone: { 'download.2-back': NONE } }
    expect(readBudgets({ budgets: { requests: BUDGETS, journeys: moves } }, JOURNEYS)).toEqual(moves)
  })

  it.each([
    ['no budgets for the moves, with budgets for the screens', { budgets: { requests: BUDGETS } }, ['`budgets.journeys` in checks.json is missing']],
    ['a window size that is not an object of moves', { budgets: { journeys: { phone: [] } } }, ['`budgets.journeys["phone"]` is not an object of moves']],
    [
      'a route missing from a move',
      { budgets: { journeys: { phone: { 'download.2-back': { ...NONE, '/qbt': undefined } } } } },
      ['`budgets.journeys["phone"]["download.2-back"]["/qbt"]` is missing'],
    ],
  ])("names the moves' budgets when it says what is wrong with %s", (_what, checks, problems) => {
    expect(readBudgets(checks, JOURNEYS)).toEqual(problems)
  })

  it('lists every problem, in every window size', () => {
    expect(readBudgets({ budgets: { requests: { phone: { downloads: { ...NONE, '/qbt': null } }, desktop: { settings: 0 } } } })).toEqual([
      '`budgets.requests["phone"]["downloads"]["/qbt"]` is not a whole number of requests, 0 or more: `null`',
      '`budgets.requests["desktop"]["settings"]` is not an object of routes',
    ])
  })
})

describe('unmatched', () => {
  const opened = [
    { size: 'phone', screen: 'downloads' },
    { size: 'phone', screen: 'settings' },
    { size: 'desktop', screen: 'downloads' },
  ]

  it('passes when every budget is for a screen the test opens, and every screen it opens has one', () => {
    expect(unmatched(BUDGETS, opened)).toEqual([])
  })

  it('names a budget for a screen the test does not open, also when another window size opens it', () => {
    expect(unmatched(BUDGETS, opened.slice(1))).toEqual([
      '`budgets.requests["phone"]["downloads"]` is a budget for a screen the test doesn\'t open: take it out of checks.json, or open the screen in e2e/performance/requests.perf.ts',
    ])
  })

  it('names a screen the test opens with no budget, in a window size with none at all too', () => {
    expect(unmatched(BUDGETS, [...opened, { size: 'desktop', screen: 'settings' }, { size: 'tablet', screen: 'downloads' }])).toEqual([
      '`budgets.requests["desktop"]["settings"]` is missing for a screen the test opens: add it to checks.json with the counts the test measures',
      '`budgets.requests["tablet"]["downloads"]` is missing for a screen the test opens: add it to checks.json with the counts the test measures',
    ])
  })
})

describe('unmatched, for the moves of journeys', () => {
  const MOVES: Budgets = { phone: { 'download.1-row': NONE, 'download.2-back': NONE } }

  it('passes when every move made has a budget and every budget a move', () => {
    expect(unmatched(MOVES, [{ size: 'phone', screen: 'download.1-row' }, { size: 'phone', screen: 'download.2-back' }], JOURNEYS)).toEqual([])
  })

  it('names a budget for a move the test does not make, and a move it makes with no budget, in the journeys test', () => {
    expect(unmatched(MOVES, [{ size: 'phone', screen: 'download.1-row' }, { size: 'desktop', screen: 'download.1-row' }], JOURNEYS)).toEqual([
      '`budgets.journeys["phone"]["download.2-back"]` is a budget for a move the test doesn\'t make: take it out of checks.json, or make the move in e2e/performance/journeys.perf.ts',
      '`budgets.journeys["desktop"]["download.1-row"]` is missing for a move the test makes: add it to checks.json with the counts the test measures',
    ])
  })
})

describe('judge', () => {
  it('passes a screen whose every count is its budget', () => {
    expect(judge(DOWNLOADS_SCREEN, WITHIN, APP, BUDGETS)).toEqual({
      passed: true,
      report: '## Requests on opening downloads (phone, `/`)\n\nEvery count is its budget.',
    })
  })

  it('fails a route over its budget, listing its requests and saying the budget is not raised to get a PR through', () => {
    const { passed, report } = judge(DOWNLOADS_SCREEN, [...WITHIN, get('/api/settings')], APP, BUDGETS)
    expect(passed).toBe(false)
    expect(report).toBe(
      [
        '## Requests on opening downloads (phone, `/`)',
        "- **`/api`: 2 requests, the budget is 1.** More than the budget: find what sends the new ones (a request sent twice, one for what the screen doesn't show) and take them out. " +
          "Raising a budget is the owner's decision, not a way to get a PR through (docs/QUALITY.md → The requests budget). Sent:\n" +
          '  - `GET /api/settings`\n  - `GET /api/settings`',
      ].join('\n\n'),
    )
  })

  it('fails a route under its budget, saying what to lower it to', () => {
    const { passed, report } = judge(DOWNLOADS_SCREEN, WITHIN.filter((request) => !request.url.endsWith('/app/version')), APP, BUDGETS)
    expect(passed).toBe(false)
    expect(report).toContain(
      '- **`/qbt`: 1 request, the budget is 2.** Fewer than the budget: lower `budgets.requests["phone"]["downloads"]["/qbt"]` in checks.json to 1. Sent:\n  - `GET /qbt/api/v2/sync/maindata?rid=0`',
    )
  })

  it('fails a route with none sent against a budget, and a request to another origin, with its whole address', () => {
    const { passed, report } = judge(
      DOWNLOADS_SCREEN,
      [...WITHIN.filter((request) => !request.url.endsWith('/api/settings')), { method: 'POST', url: 'https://example.org/collect?id=1' }],
      APP,
      BUDGETS,
    )
    expect(passed).toBe(false)
    expect(report.split('\n\n').slice(1).map((failure) => failure.replace(/\*\* .* Sent:/, '** … Sent:'))).toEqual([
      '- **`/api`: 0 requests, the budget is 1.** … Sent:\n  - none',
      '- **`other origins`: 1 request, the budget is 0.** … Sent:\n  - `POST https://example.org/collect?id=1`',
    ])
  })

  it.each([
    ['a window size that has budgets for other screens', 'desktop'],
    ['a window size with no budgets at all', 'tablet'],
  ])('fails a screen with no budget in %s, saying where to add it', (_what, size) => {
    expect(judge({ size, screen: 'settings', path: '/settings' }, WITHIN, APP, BUDGETS)).toEqual({
      passed: false,
      report:
        `## Requests on opening settings (${size}, \`/settings\`)\n\n` +
        `\`budgets.requests["${size}"]["settings"]\` is missing for a screen the test opens: add it to checks.json with the counts the test measures`,
    })
  })
})

describe('judge, for a move', () => {
  const BACK = { size: 'phone', screen: 'download.2-back', path: '/' }
  const MOVES: Budgets = { phone: { 'download.2-back': { ...NONE, '/qbt': 1 } } }

  it('names the move, its window size and where it led', () => {
    expect(judge(BACK, [get('/qbt/api/v2/sync/maindata?rid=1')], APP, MOVES, JOURNEYS)).toEqual({
      passed: true,
      report: '## Requests on the move download.2-back (phone, to `/`)\n\nEvery count is its budget.',
    })
  })

  it("says to lower the move's budget in budgets.journeys", () => {
    const { passed, report } = judge(BACK, [], APP, MOVES, JOURNEYS)
    expect(passed).toBe(false)
    expect(report).toContain('Fewer than the budget: lower `budgets.journeys["phone"]["download.2-back"]["/qbt"]` in checks.json to 0.')
  })

  it('fails a move with no budget, saying where to add it', () => {
    expect(judge({ ...BACK, size: 'desktop' }, [], APP, MOVES, JOURNEYS)).toEqual({
      passed: false,
      report:
        '## Requests on the move download.2-back (desktop, to `/`)\n\n' +
        '`budgets.journeys["desktop"]["download.2-back"]` is missing for a move the test makes: add it to checks.json with the counts the test measures',
    })
  })
})

describe('clockRun', () => {
  it('runs the clock 1 ms less than the shortest poll interval', () => {
    expect(clockRun({ POLL_INTERVAL_MS: 2_000, OFFLINE_POLL_INTERVAL_MS: 5_000, FILES_POLL_INTERVAL_MS: 3_000 })).toBe(1_999)
  })

  it('takes an interval of 2 ms, which leaves the clock 1 ms to run', () => {
    expect(clockRun({ FAST_POLL_INTERVAL_MS: 2 })).toBe(1)
  })

  const ONLY = 'the module exports only poll intervals, which the test runs the clock by'
  const wrong = (name: string, what: string) => `\`${name}\` in \`src/torrents/pollIntervals.ts\` is not a whole number of milliseconds above 1: ${what}; ${ONLY}`
  const misnamed = (name: string) => `\`${name}\` in \`src/torrents/pollIntervals.ts\` isn't named as a poll interval (\`…_INTERVAL_MS\`); ${ONLY}`

  it.each([
    ['a function', { POLL_INTERVAL_MS: 2_000, DESCRIBE_INTERVAL_MS: (ms: number) => `${ms} ms` }, [wrong('DESCRIBE_INTERVAL_MS', 'a function')]],
    ['a number that is no interval', { POLL_INTERVAL_MS: 2_000, POLL_FAILURES_SHOWN: 3 }, [misnamed('POLL_FAILURES_SHOWN')]],
    ['a name that only ends like one', { POLL_INTERVAL_MS: 2_000, old_POLL_INTERVAL_MS: 3_000, X_INTERVAL_MS_OLD: 4_000 }, [misnamed('old_POLL_INTERVAL_MS'), misnamed('X_INTERVAL_MS_OLD')]],
    ['a BigInt', { POLL_INTERVAL_MS: 10n }, [wrong('POLL_INTERVAL_MS', '`10n`')]],
    ['null', { POLL_INTERVAL_MS: null }, [wrong('POLL_INTERVAL_MS', '`null`')]],
    ['a negative number', { POLL_INTERVAL_MS: -2_000 }, [wrong('POLL_INTERVAL_MS', '`-2000`')]],
    ['a string', { POLL_INTERVAL_MS: '2000' }, [wrong('POLL_INTERVAL_MS', '`"2000"`')]],
    ['not a number', { POLL_INTERVAL_MS: Number.NaN }, [wrong('POLL_INTERVAL_MS', '`NaN`')]],
    ['a fraction', { POLL_INTERVAL_MS: 1_999.5 }, [wrong('POLL_INTERVAL_MS', '`1999.5`')]],
    ['1 ms, which leaves the clock no time', { POLL_INTERVAL_MS: 1 }, [wrong('POLL_INTERVAL_MS', '`1`')]],
    ['two wrong at once', { A_INTERVAL_MS: 0, b: 2_000 }, [wrong('A_INTERVAL_MS', '`0`'), misnamed('b')]],
    ['nothing exported', {}, ['`src/torrents/pollIntervals.ts` exports no poll interval, so the test has no time to run the clock for']],
  ])('says what is wrong with %s rather than running the clock by it', (_what, intervals, problems) => {
    expect(clockRun(intervals)).toEqual(problems)
  })
})

describe('clockShare', () => {
  it("gives the opening and each move the same share of the clock's run, rounded down", () => {
    expect(clockShare(1_999, 4, 100)).toBe(499)
  })

  it('gives a journey of the opening alone the whole run', () => {
    expect(clockShare(1_999, 1, 100)).toBe(1_999)
  })

  it('takes a share of exactly the least a part needs', () => {
    expect(clockShare(400, 4, 100)).toBe(100)
  })

  it('fails a journey whose share would be shorter than the least a part needs, rather than running it', () => {
    expect(clockShare(399, 4, 100)).toEqual([
      "A journey of 4 parts gives each 99 ms of the clock's 399 ms, less than the 100 ms a part needs: " +
        'make the journey shorter, so a move still has time for its timers and no poll repeats',
    ])
  })

  it.each([
    ['no parts', 0, '`0`'],
    ['a fraction of a part', 1.5, '`1.5`'],
    ['a number of parts that is not a number', Number.NaN, '`NaN`'],
  ])('says what is wrong with %s', (_what, parts, shown) => {
    expect(clockShare(1_999, parts, 100)).toEqual([`A journey has ${shown} parts; it has its opening and each move, 1 or more`])
  })
})

describe('table', () => {
  it('lists the counts by window size and screen, in a steady order', () => {
    expect(
      table([
        { size: 'phone', screen: 'settings', counts: NONE },
        { size: 'phone', screen: 'downloads', counts: DOWNLOADS },
        { size: 'desktop', screen: 'downloads', counts: { ...DOWNLOADS, '/tmdb-img': 3 } },
      ]),
    ).toBe(
      [
        '## Requests on opening a screen',
        [
          '| Window | Screen | `/qbt` | `/tmdb` | `/tmdb-img` | `/prowlarr` | `/api` | `other paths` | `other origins` |',
          '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
          '| desktop | downloads | 2 | 0 | 3 | 0 | 1 | 0 | 0 |',
          '| phone | downloads | 2 | 0 | 0 | 0 | 1 | 0 | 0 |',
          '| phone | settings | 0 | 0 | 0 | 0 | 0 | 0 | 0 |',
        ].join('\n'),
      ].join('\n\n'),
    )
  })
})

describe('table, for the moves of journeys', () => {
  it('heads the table with the moves, in their order in each journey', () => {
    expect(
      table(
        [
          { size: 'phone', screen: 'download.2-back', counts: NONE },
          { size: 'phone', screen: 'download.1-row', counts: DOWNLOADS },
        ],
        JOURNEYS,
      ),
    ).toBe(
      [
        '## Requests on a move between screens',
        [
          '| Window | Move | `/qbt` | `/tmdb` | `/tmdb-img` | `/prowlarr` | `/api` | `other paths` | `other origins` |',
          '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
          '| phone | download.1-row | 2 | 0 | 0 | 0 | 1 | 0 | 0 |',
          '| phone | download.2-back | 0 | 0 | 0 | 0 | 0 | 0 | 0 |',
        ].join('\n'),
      ].join('\n\n'),
    )
  })
})
