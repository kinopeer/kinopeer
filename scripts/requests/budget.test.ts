import { describe, expect, it } from 'vitest'
import { countsOf, grouped, judge, keyOf, readBudgets, table, unmatched, type Budgets, type Counts, type Sent } from './budget.ts'

const APP = 'http://localhost:4174'
const NONE: Counts = { '/qbt': 0, '/tmdb': 0, '/tmdb-img': 0, '/prowlarr': 0, '/api': 0, 'other origins': 0 }
const DOWNLOADS: Counts = { ...NONE, '/qbt': 2, '/api': 1 }
const BUDGETS: Budgets = { phone: { downloads: DOWNLOADS, settings: NONE }, desktop: { downloads: DOWNLOADS } }
const get = (path: string, method = 'GET'): Sent => ({ method, url: `${APP}${path}` })
/** What the downloads screen sends within its budget: the session check, the poll, the settings, and the app's own files. */
const WITHIN = [get('/'), get('/assets/index-Ab12.js'), get('/qbt/api/v2/app/version'), get('/qbt/api/v2/sync/maindata?rid=0'), get('/api/settings')]
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
    expect(keyOf(`${APP}${path}`, APP)).toBe(key)
  })

  it.each([
    ['the page', '/title/movie/693134'],
    ['a script', '/assets/index-Ab12.js'],
    ['a path that only starts with a route', '/apiary.png'],
    ['a path that only starts with a route, followed by a dash', '/tmdb-other/x'],
    ['the version file', '/version.json'],
  ])("doesn't count %s, the app's own file", (_what, path) => {
    expect(keyOf(`${APP}${path}`, APP)).toBeNull()
  })

  it.each([
    ['another host', 'https://fonts.example.com/onest.woff2'],
    ["another port of the app's host", 'http://localhost:4173/qbt/api/v2/app/version'],
    ['another scheme of the same host', 'https://localhost:4174/api/settings'],
  ])('counts a request to %s against other origins', (_what, url) => {
    expect(keyOf(url, APP)).toBe('other origins')
  })

  it.each(['data:image/png;base64,AAAA', 'blob:http://localhost:4174/1b2c'])("doesn't count %s, which isn't fetched", (url) => {
    expect(keyOf(url, APP)).toBeNull()
  })
})

describe('grouped and countsOf', () => {
  it('keeps each key its requests in the order sent, and counts them', () => {
    const byKey = grouped([...WITHIN, get('/qbt/api/v2/torrents/categories'), { method: 'GET', url: 'https://example.org/x' }], APP)
    expect(byKey['/qbt']).toEqual([get('/qbt/api/v2/app/version'), get('/qbt/api/v2/sync/maindata?rid=0'), get('/qbt/api/v2/torrents/categories')])
    expect(countsOf(byKey)).toEqual({ ...NONE, '/qbt': 3, '/api': 1, 'other origins': 1 })
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
      ['`budgets.requests["phone"]["downloads"]["/healthz"]` is no route the check counts (`/qbt`, `/tmdb`, `/tmdb-img`, `/prowlarr`, `/api`, `other origins`)'],
    ],
  ])('says what is wrong with %s rather than passing it', (_what, checks, problems) => {
    expect(readBudgets(checks)).toEqual(problems)
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

  it('fails a screen with no budget, saying where to add it', () => {
    expect(judge({ size: 'desktop', screen: 'settings', path: '/settings' }, WITHIN, APP, BUDGETS)).toEqual({
      passed: false,
      report:
        '## Requests on opening settings (desktop, `/settings`)\n\n' +
        '`budgets.requests["desktop"]["settings"]` is missing for a screen the test opens: add it to checks.json with the counts the test measures',
    })
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
          '| Window | Screen | `/qbt` | `/tmdb` | `/tmdb-img` | `/prowlarr` | `/api` | `other origins` |',
          '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
          '| desktop | downloads | 2 | 0 | 3 | 0 | 1 | 0 |',
          '| phone | downloads | 2 | 0 | 0 | 0 | 1 | 0 |',
          '| phone | settings | 0 | 0 | 0 | 0 | 0 | 0 |',
        ].join('\n'),
      ].join('\n\n'),
    )
  })
})
