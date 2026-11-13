import type { Page } from '@playwright/test'
import { expect, test } from './test.ts'
import { DESKTOP, openApp, settle } from './app.ts'
import { RELEASES } from './fixtures.ts'

/** Sheets and dialogs as centered modals on desktop. On phones they're covered by the screens' tests. */
test.describe('modals, desktop', () => {
  test.use(DESKTOP)

  async function openReleases(page: Page) {
    await openApp(page, '/title/tv/126308/releases')
    await expect(page.getByText(RELEASES[0].title)).toBeVisible()
    await settle(page)
  }

  test('adding a release, then picking its files, dark, Russian', async ({ page }) => {
    await openReleases(page)
    await page.getByRole('button', { name: 'Добавить в загрузки' }).first().click()
    const files = page.getByRole('button', { name: /Файлы: все \(14\)/ })
    await expect(files).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-add-dark-ru.png')

    await files.click()
    await page.getByRole('button', { name: /^Episodes/ }).click()
    await expect(page.getByText(/Shogun\.S01E10/)).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-add-files-dark-ru.png')
  })

  test('deleting a torrent, dark, Russian', async ({ page }) => {
    await openApp(page, '/')
    await page.getByRole('button', { name: 'Ещё действия: Дюна: Часть вторая' }).click()
    // On desktop a download's actions are a menu next to its More button.
    await page.getByRole('menuitem', { name: 'Удалить' }).click()
    await expect(page.getByRole('alertdialog', { name: 'Удалить торрент?' })).toBeVisible()
    await settle(page)
    await expect(page).toHaveScreenshot('desktop-delete-dark-ru.png')
  })
})
