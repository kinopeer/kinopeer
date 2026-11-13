// The screens the performance tests open by their address: the requests test counts what each asks
// for (requests.perf.ts), the layout shift test how far each moves as it loads (layoutShift.perf.ts).
// One list, so a screen added for one test is opened by the other too, whose check that each screen
// has a budget and every budget a screen fails until the screen has its budget there.
import type { Heading, Loaded } from './page.ts'

/**
 * Each screen by its name (its budgets' key), its address, its own heading (`desktop` where the
 * desktop's differs) and, where that heading stays above a "not answering" or empty state, a control
 * only the loaded content has: every screen the screenshot tests open by an address. What they open
 * besides is another state of one of these (another torrent's page, a search that finds nothing,
 * onboarding), left out as docs/QUALITY.md says.
 */
export const SCREENS: { screen: string; path: string; heading: Heading; desktop?: Heading; loaded?: Loaded }[] = [
  { screen: 'downloads', path: '/', heading: { level: 1, name: 'Загрузки' }, loaded: { role: 'link', name: 'Дюна: Часть вторая' } },
  // On desktop the torrent's drawer over Downloads.
  { screen: 'torrent', path: '/torrent/p2', heading: { level: 1, name: 'Сёгун' }, desktop: { level: 2, name: 'Сёгун' } },
  { screen: 'browse', path: '/search', heading: { level: 1, name: 'Поиск' }, loaded: { role: 'link', name: 'Оппенгеймер' } },
  { screen: 'search', path: '/search?q=%D0%B4%D1%8E%D0%BD%D0%B0', heading: { level: 1, name: 'Поиск' }, loaded: { role: 'link', name: 'Дюна: Часть вторая' } },
  // With a year, movies and series are searched apart.
  { screen: 'search-year', path: '/search?q=%D0%B0&year=2022', heading: { level: 1, name: 'Поиск' }, loaded: { role: 'link', name: 'Разделение' } },
  { screen: 'title', path: '/title/movie/693134', heading: { level: 1, name: 'Дюна: Часть вторая' } },
  { screen: 'series', path: '/title/tv/126308', heading: { level: 1, name: 'Сёгун' } },
  // On desktop the title page with its releases under the hero.
  { screen: 'releases', path: '/title/tv/126308/releases', heading: { level: 1, name: 'Раздачи' }, desktop: { level: 1, name: 'Сёгун' }, loaded: { role: 'button', name: 'Добавить в загрузки' } },
  { screen: 'settings', path: '/settings', heading: { level: 1, name: 'Настройки' } },
]
