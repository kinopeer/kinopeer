import { expect, test } from './test.ts'
import { DESKTOP } from '../app.ts'
import { RELEASES, TORRENTS, shogunTorrent } from '../../src/test/fixtures.ts'
import { PROWLARR_KEY, PROXY_DENIED_HEADER, SHOGUN_HASH, TMDB_KEY, resetStand, standState } from './control.ts'

test.use(DESKTOP)

/**
 * From a search to a new download on desktop: the .torrent travels Prowlarr → server → browser,
 * the browser reads its files and sends qBittorrent the torrent stopped, the skipped file's
 * priority and the start, in that order, and the new torrent shows up in Downloads with its title.
 */
test('search → title → releases → add with a file skipped → in Downloads', async ({ page }) => {
  // Without the fixtures' Shōgun torrent, so the one in the list at the end is the one added.
  await resetStand({ torrents: TORRENTS.filter((torrent) => torrent.hash !== 'a2') })
  const urls: string[] = []
  page.on('request', (request) => urls.push(request.url()))
  const refused: string[] = []
  page.on('response', (response) => {
    if (response.headers()[PROXY_DENIED_HEADER]) refused.push(response.url())
  })

  // A deep link as the first load: the server's SPA fallback, not the service worker.
  await page.goto('/search?q=Сёгун')
  await page.getByRole('link', { name: /Сёгун/ }).click()
  await expect(page).toHaveURL(/\/title\/tv\/126308$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Сёгун' })).toBeVisible()

  await page.getByRole('button', { name: 'Найти раздачи' }).click()
  await expect(page).toHaveURL(/\/title\/tv\/126308\/releases$/)
  await expect(page.getByText(RELEASES[0].title)).toBeVisible()
  await page.getByRole('button', { name: 'Добавить в загрузки' }).first().click()

  // The browser read the .torrent: all 14 files, one of which is left out.
  await page.getByRole('button', { name: /^Файлы: все \(14\)/ }).click()
  await page.getByRole('button', { name: /^Episodes/ }).click()
  await page.getByRole('checkbox', { name: /Shogun\.S01E10/ }).click()
  await page.getByRole('button', { name: 'Готово' }).click()
  await expect(page.getByRole('button', { name: /^Файлы: 13 из 14/ })).toBeVisible()
  await page.getByRole('button', { name: /^Скачать/ }).click()

  await expect(page).toHaveURL(/:4300\/$/)
  await expect(page.getByRole('status').filter({ hasText: '«Сёгун» — добавлено в загрузки' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Загрузки' }).getByText('Сёгун', { exact: true })).toBeVisible()

  const stand = await standState()
  expect(stand.qbittorrent.added).toEqual([
    {
      files: [{ name: expect.stringMatching(/\.torrent$/), size: shogunTorrent().length }],
      tags: ['tmdb:tv:126308'],
      category: 'TV Shows',
      stopped: true,
    },
  ])
  const calls = stand.qbittorrent.seen
    .map((request) => ({ path: new URL(request.url ?? '', 'http://qbt').pathname, params: Object.fromEntries(new URLSearchParams(request.body)) }))
    .filter(({ path }) => /\/torrents\/(add|filePrio|start)$/.test(path))
  expect(calls).toEqual([
    { path: '/api/v2/torrents/add', params: expect.anything() },
    { path: '/api/v2/torrents/filePrio', params: { hash: SHOGUN_HASH, id: '9', priority: '0' } },
    { path: '/api/v2/torrents/start', params: { hashes: SHOGUN_HASH } },
  ])
  expect(stand.qbittorrent.torrents).toContain(SHOGUN_HASH)

  // The server searched with Prowlarr's key, asked which indexers failed (none, so it didn't need
  // their names) and put the key back into the download link it had stripped for the browser; it
  // asked TMDB with the saved key. The page saw neither key.
  expect(stand.prowlarr.seen.map((request) => request.url)).toEqual([
    expect.stringMatching(/^\/api\/v1\/search\?query=/),
    '/api/v1/indexerstatus',
    `/api/v1/indexer/1/download?link=shogun&apikey=${PROWLARR_KEY}`,
  ])
  expect(stand.prowlarr.seen.map((request) => request.key)).toEqual(Array(3).fill(PROWLARR_KEY))
  expect(stand.tmdb.seen.map((request) => request.url)).toContain(`/3/tv/126308?language=ru-RU&api_key=${TMDB_KEY}`)
  for (const url of urls) {
    expect(url).not.toContain(PROWLARR_KEY)
    expect(url).not.toContain(TMDB_KEY)
    expect(url).not.toMatch(/apikey=/)
  }
  expect(refused).toEqual([])
})
