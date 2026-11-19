import { expect, test } from './test.ts'
import { resetStand, standState } from './control.ts'

/**
 * Kinopeer's own login beyond Umbrel, through the production server: the first visitor sets the
 * password and is let in, the session cookie is one a script can't read and another site's request
 * doesn't carry, it outlasts a reload, and once signed out nothing of the server's answers until the
 * password is entered again. What the server's tests can't see is that the browser keeps and sends
 * the cookie, and that the app swaps itself for the sign-in and back.
 */
test('the login: set the password, stay signed in, sign out and in again', async ({ page, context }) => {
  await resetStand({ ownLogin: true })
  const holdBack = () => page.evaluate(() => fetch('/qbt/api/v2/app/version', { headers: { 'X-Kinopeer': '1' } }).then((response) => response.status))

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Задайте пароль' })).toBeVisible()
  // Nothing behind the server was asked while no one was signed in.
  expect((await standState()).qbittorrent.seen).toEqual([])

  await page.getByLabel('Новый пароль').fill('correct horse')
  await page.getByLabel('Повторите пароль').fill('correct horse')
  await page.getByRole('button', { name: 'Задать пароль' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  await expect(page.getByText('Дюна: Часть вторая', { exact: true }).first()).toBeVisible()

  const session = (await context.cookies()).find((cookie) => cookie.name === 'kinopeer_session')
  expect(session).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/', secure: false })
  expect(session!.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 24 * 60 * 60)

  // A reload rides on the cookie.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()

  await page.getByRole('navigation', { name: 'Основное' }).getByRole('link', { name: 'Настройки' }).click()
  await page.getByRole('button', { name: /Выйти/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Вход в Kinopeer' })).toBeVisible()
  expect(await holdBack()).toBe(401)

  await page.getByLabel('Пароль').fill('wrong horse')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByText('Неверный пароль')).toBeVisible()
  await page.getByLabel('Пароль').fill('correct horse')
  await page.getByRole('button', { name: 'Войти' }).click()
  // Back on the screen it was signed out from.
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible()
  expect(await holdBack()).toBe(200)
})
