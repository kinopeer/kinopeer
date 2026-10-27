import { expect, test } from '@playwright/test'
import { DESKTOP } from '../app.ts'
import type { Matches } from '../../src/api/matches/types.ts'
import { TORRENTS } from '../../src/test/fixtures.ts'
import { PROXY_DENIED_HEADER, resetStand, standState } from './control.ts'

test.use(DESKTOP)

/** The fixtures' short hashes as info hashes, which the server's matches route wants. */
const hashOf = (short: string) => short.padEnd(40, '0')
const TORRENTS_WITH_HASHES = TORRENTS.map((torrent) => ({ ...torrent, hash: hashOf(torrent.hash) }))

/** The user's own title choices for the torrents the journey deletes, and one it keeps. */
const MATCHES: Matches = {
  [hashOf('a5')]: { type: 'movie', id: 872585, source: 'user' },
  [hashOf('a1')]: { type: 'movie', id: 693134, source: 'user' },
  [hashOf('a2')]: { type: 'tv', id: 126308, source: 'user' },
  [hashOf('a3')]: { type: 'movie', id: 545611, source: 'user' },
}

/**
 * Deleting on desktop: one torrent with its files from the drawer, then two at once from the
 * list. qBittorrent gets each call on the server's session, the list drops the rows from the next
 * poll without a reload, the server forgets their matches, and Escape in either confirmation deletes
 * nothing, closing only the confirmation.
 */
test('deleting from the drawer with its files, then two at once from the list', async ({ page }) => {
  await resetStand({ torrents: TORRENTS_WITH_HASHES, matches: MATCHES })
  const refused: string[] = []
  page.on('response', (response) => {
    if (response.headers()[PROXY_DENIED_HEADER]) refused.push(response.url())
  })

  // A deep link to a torrent: Downloads with the drawer over it.
  await page.goto(`/torrent/${hashOf('a5')}`)
  const drawer = page.getByRole('dialog', { name: 'Оппенгеймер' })
  await expect(drawer.getByRole('heading', { level: 2, name: 'Оппенгеймер' })).toBeVisible()
  const list = page.getByRole('region', { name: 'Загрузки' })
  await expect(list.getByText('Оппенгеймер', { exact: true })).toBeVisible()

  await drawer.getByRole('button', { name: 'Удалить' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Удалить торрент?' })
  await expect(confirm).toBeVisible()
  // Escape closes only the confirmation; the drawer it was opened from stays.
  await page.keyboard.press('Escape')
  await expect(confirm).toBeHidden()
  await expect(drawer).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/torrent/${hashOf('a5')}$`))
  expect((await standState()).qbittorrent.deleted).toEqual([])

  await drawer.getByRole('button', { name: 'Удалить' }).click()
  await confirm.getByRole('checkbox', { name: /^Удалить и файлы/ }).click()
  await confirm.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Торрент и файлы удалены' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(list.getByText('Оппенгеймер', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Выбрать', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Дюна: Часть вторая' }).first().click()
  await page.getByRole('checkbox', { name: 'Сёгун' }).first().click()
  const toolbar = page.getByRole('toolbar', { name: 'Выбрано: 2' })
  await toolbar.getByRole('button', { name: 'Удалить' }).click()
  const confirmMany = page.getByRole('alertdialog', { name: 'Удалить торренты?' })
  await expect(confirmMany).toBeVisible()
  // Escape on the native <dialog> cancels: nothing reaches qBittorrent, the selection stays.
  await page.keyboard.press('Escape')
  await expect(confirmMany).toBeHidden()
  await expect(toolbar).toBeVisible()
  expect((await standState()).qbittorrent.deleted).toHaveLength(1)

  await toolbar.getByRole('button', { name: 'Удалить' }).click()
  await confirmMany.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Удалено 2 торрента' })).toBeVisible()
  await expect(list.getByText('Дюна: Часть вторая', { exact: true })).toHaveCount(0)
  await expect(list.getByText('Сёгун', { exact: true })).toHaveCount(0)
  await expect(list.getByText('Всё везде и сразу', { exact: true })).toBeVisible()

  const stand = await standState()
  expect(stand.qbittorrent.deleted).toEqual([
    { hashes: [hashOf('a5')], deleteFiles: true },
    { hashes: expect.arrayContaining([hashOf('a1'), hashOf('a2')]), deleteFiles: false },
  ])
  expect(stand.qbittorrent.deleted[1].hashes).toHaveLength(2)
  const deletes = stand.qbittorrent.seen.filter((request) => request.url === '/api/v2/torrents/delete')
  expect(deletes.map((request) => request.cookie)).toEqual([expect.stringMatching(/^SID=\w+$/), expect.stringMatching(/^SID=\w+$/)])
  expect(stand.qbittorrent.torrents).toEqual(['a3', 'a4', 'a6', 'a7', 'a8', 'a9'].map(hashOf))
  // The matches are forgotten right after the delete, without waiting for the hourly cleanup.
  await expect.poll(async () => (await standState()).matches).toEqual({ [hashOf('a3')]: MATCHES[hashOf('a3')] })
  expect(refused).toEqual([])
})
