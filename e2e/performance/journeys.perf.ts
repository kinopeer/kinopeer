// What each move between screens asks the servers for (docs/QUALITY.md → The requests budget): the
// built app, every server route mocked as in the screenshot tests, short journeys that open one
// screen by its address and then move the way a person does (a tap on a row, a link or a tab, typing
// a search, the browser's Back), each move's requests counted by route and compared with
// `budgets.journeys` in checks.json. The opening isn't counted here: requests.perf.ts counts it. The
// rules are in scripts/requests/budget.ts; this file only collects the numbers.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { clockShare, countsOf, grouped, JOURNEYS, judge, readBudgets, unmatched, type App, type Budgets, type Opened } from '../../scripts/requests/budget.ts'
import { tmdbTag, torrent } from '../../src/test/fixtures.ts'
import { prepareApp } from '../app.ts'
import { builtPaths, holdClock, record, runClock, RUN_MS, SIZES, STEP_MS, type Heading, type Loaded } from './page.ts'

/**
 * The test's own torrents, all tagged with their title, so no title is guessed and saved a second
 * later in the middle of some other move. The opening test keeps a guessed one, whose save it counts.
 */
const TORRENTS = [
  torrent('p1', { name: 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX-GRPA', tags: tmdbTag('movie', 693134), category: 'Movies', progress: 0.5 }),
  torrent('p2', { name: 'Shogun.S01.2160p.WEB-DL.DDP5.1.H.265-GRPB', tags: tmdbTag('tv', 126308), category: 'TV Shows', state: 'uploading', progress: 1 }),
  torrent('p3', { name: 'Interstellar.2014.1080p.BluRay.x264-GRPC', tags: tmdbTag('movie', 157336), state: 'pausedDL', progress: 0.1 }),
]

/**
 * A screen as the test checks it after a part of a journey: its own heading, not a crash or another
 * screen, and where that heading stays above a "not answering" or empty state, a control only its
 * loaded content has. `dialog` when the screen is a dialog (the torrent's drawer on desktop); else
 * none may be open, so a drawer left over isn't taken for the page under it.
 */
type Screen = { heading: Heading; loaded?: Loaded; dialog?: boolean }
/** A move: its name in the journey, what the person does, and the screen it leads to. */
type Move = { move: string; make: (page: Page) => Promise<unknown>; to: Screen }
/** A journey: the screen it opens by its address, then its moves, which may differ by window size. */
type Journey = { journey: string; path: string; opens: Screen; moves: (desktop: boolean) => Move[] }

const DOWNLOADS: Screen = { heading: { level: 1, name: 'Загрузки' }, loaded: { role: 'link', name: 'Дюна: Часть вторая' } }
const BROWSE: Screen = { heading: { level: 1, name: 'Поиск' }, loaded: { role: 'link', name: 'Оппенгеймер' } }
/** The search's results: the Show more under them, which the rows before a search don't have. */
const FOUND: Screen = { heading: { level: 1, name: 'Поиск' }, loaded: { role: 'button', name: 'Показать ещё' } }
const SETTINGS: Screen = { heading: { level: 1, name: 'Настройки' } }
const DUNE: Screen = { heading: { level: 1, name: 'Дюна: Часть вторая' } }
const SHOGUN: Screen = { heading: { level: 1, name: 'Сёгун' } }
/** The torrent's page on a phone, its drawer over Downloads on desktop. */
const torrentOf = (desktop: boolean): Screen => (desktop ? { heading: { level: 2, name: 'Дюна: Часть вторая' }, dialog: true } : DUNE)

/** A torrent's row (a card in the desktop grid) by its title. */
const row = (page: Page) => page.getByRole('link', { name: 'Дюна: Часть вторая' }).first()
/**
 * A tab: the tab bar's on a phone, the sidebar's on desktop, by the name it starts with (the
 * sidebar's Downloads also names how many torrents are downloading).
 */
const tab = (page: Page, name: string) => page.getByRole('navigation').getByRole('link', { name: new RegExp(`^${name}`) })

/**
 * The journeys, each a test. A move's budget is named by its journey and its place in it, since the
 * same move costs differently after another path.
 */
const JOURNEYS_MADE: Journey[] = [
  {
    journey: 'download',
    path: '/',
    opens: DOWNLOADS,
    moves: (desktop) => [
      { move: '1-row', make: (page) => row(page).click(), to: torrentOf(desktop) },
      { move: '2-back', make: (page) => page.goBack(), to: DOWNLOADS },
      { move: '3-row-again', make: (page) => row(page).click(), to: torrentOf(desktop) },
    ],
  },
  {
    journey: 'find',
    path: '/search',
    opens: BROWSE,
    moves: () => [
      { move: '1-query', make: (page) => page.getByRole('searchbox').pressSequentially('дюна'), to: FOUND },
      { move: '2-title', make: (page) => page.getByRole('main').getByRole('link', { name: 'Дюна: Часть вторая' }).first().click(), to: DUNE },
      { move: '3-back', make: (page) => page.goBack(), to: FOUND },
    ],
  },
  {
    journey: 'releases',
    path: '/title/tv/126308',
    opens: SHOGUN,
    moves: (desktop) => [
      {
        move: '1-releases',
        make: (page) => page.getByRole('button', { name: 'Найти раздачи' }).click(),
        // On desktop the releases are on the title page, under the hero.
        to: { heading: desktop ? SHOGUN.heading : { level: 1, name: 'Раздачи' }, loaded: { role: 'button', name: 'Добавить в загрузки' } },
      },
      // On desktop the releases replace the title page's entry, so the browser's Back would leave the
      // app opened by an address: the page's own Back, which goes to Search from such a page.
      desktop
        ? { move: '2-back', make: (page) => page.getByRole('button', { name: 'Назад', exact: true }).click(), to: BROWSE }
        : { move: '2-back', make: (page) => page.goBack(), to: SHOGUN },
    ],
  },
  {
    journey: 'tabs',
    path: '/',
    opens: DOWNLOADS,
    moves: () => [
      { move: '1-search', make: (page) => tab(page, 'Поиск').click(), to: BROWSE },
      { move: '2-settings', make: (page) => tab(page, 'Настройки').click(), to: SETTINGS },
      { move: '3-downloads', make: (page) => tab(page, 'Загрузки').click(), to: DOWNLOADS },
    ],
  },
]

/** A move's budget's name: its journey and its place in it. */
const nameOf = (journey: Journey, move: Move) => `${journey.journey}.${move.move}`

const BUDGETS = readBudgets(JSON.parse(readFileSync(new URL('../../checks.json', import.meta.url), 'utf8')), JOURNEYS)

/** Checks the page shows the screen meant, loaded. */
async function shows(page: Page, { heading: { level, name }, loaded, dialog }: Screen): Promise<void> {
  await expect(page.getByRole('heading', { level, name, exact: true })).toBeVisible()
  if (loaded) await expect(page.getByRole(loaded.role, { name: loaded.name }).first()).toBeVisible()
  if (!dialog) await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('the poll intervals give a journey a share of the clock to run for', () => {
  expect(RUN_MS, `src/torrents/pollIntervals.ts can't be read:\n${[RUN_MS].flat().join('\n')}`).not.toBeInstanceOf(Array)
})

test('every budget is for a move the test makes, and every move it makes has one', () => {
  expect(BUDGETS, 'budgets.journeys in checks.json').not.toBeInstanceOf(Array)
  const made: Opened[] = SIZES.flatMap(({ size }) =>
    JOURNEYS_MADE.flatMap((journey) => journey.moves(size === 'desktop').map((move) => ({ size, screen: nameOf(journey, move) }))),
  )
  expect(unmatched(BUDGETS as Budgets, made, JOURNEYS)).toEqual([])
})

for (const { size, use } of SIZES) {
  test.describe(size, () => {
    test.use(use)
    for (const journey of JOURNEYS_MADE) {
      test(journey.journey, async ({ page, baseURL }, testInfo) => {
        const moves = journey.moves(size === 'desktop')
        expect(RUN_MS, `src/torrents/pollIntervals.ts can't be read:\n${[RUN_MS].flat().join('\n')}`).not.toBeInstanceOf(Array)
        // The opening and each move get the same share of the clock, so no poll repeats in the journey.
        const share = clockShare(RUN_MS as number, moves.length + 1, STEP_MS)
        expect(share, `The journey's share of the clock:\n${[share].flat().join('\n')}`).not.toBeInstanceOf(Array)
        expect(BUDGETS, `budgets.journeys in checks.json can't be read:\n${[BUDGETS].flat().join('\n')}`).not.toBeInstanceOf(Array)
        const app: App = { origin: new URL(baseURL!).origin, files: builtPaths() }

        // The opening, which requests.perf.ts counts: here it only sets the journey off.
        const { inFlight, take } = record(page)
        await holdClock(page)
        await prepareApp(page, { torrents: TORRENTS })
        await page.goto(journey.path)
        await runClock(page, inFlight, share as number)
        await shows(page, journey.opens)
        take()

        const verdicts: string[] = []
        for (const move of moves) {
          const name = nameOf(journey, move)
          await move.make(page)
          await runClock(page, inFlight, share as number)
          await shows(page, move.to)
          const sent = take()
          const { pathname, search } = new URL(page.url())
          await testInfo.attach('journey requests', {
            contentType: 'application/json',
            body: JSON.stringify({ size, screen: name, counts: countsOf(grouped(sent, app)) }),
          })
          const { passed, report } = judge({ size, screen: name, path: `${pathname}${search}` }, sent, app, BUDGETS as Budgets, JOURNEYS)
          if (!passed) verdicts.push(report)
        }
        // Every move judged, so one failure names every move off its budget.
        expect(verdicts, verdicts.join('\n\n')).toEqual([])
      })
    }
  })
}
