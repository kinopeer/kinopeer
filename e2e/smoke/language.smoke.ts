import { expect, test } from './test.ts'
import { PROXY_DENIED_HEADER, resetStand } from './control.ts'

/**
 * Each language's texts are a file of their own, loaded when the page shows that language (#492,
 * src/i18n/language.ts). What only the built app shows: the page loads only its own language's file,
 * its first render already has the texts (main.tsx waits for them, so neither the keys nor English
 * flash first), and a switch in Settings loads the other language's file.
 */
test('the app loads only the language it shows, renders in it from the first paint, and loads another on a switch', async ({ page }) => {
  await resetStand()
  const refused: string[] = []
  page.on('response', (response) => {
    if (response.headers()[PROXY_DENIED_HEADER]) refused.push(response.url())
  })
  const languageFiles: string[] = []
  page.on('request', (request) => {
    const language = /^\/assets\/language-([a-z]+)-/.exec(new URL(request.url()).pathname)?.[1]
    if (language) languageFiles.push(language)
  })
  // The root's text at its first render, before anything else changes it.
  await page.addInitScript(() => {
    new MutationObserver((_records, observer) => {
      const text = document.getElementById('root')?.textContent
      if (!text) return
      sessionStorage.setItem('firstText', text)
      observer.disconnect()
    }).observe(document, { childList: true, subtree: true })
  })

  // The browser prefers Russian (playwright.config.ts) and nothing is saved, so the app follows it.
  await page.goto('/settings')
  await expect(page.getByRole('navigation', { name: 'Основное' })).toBeVisible()
  const firstText = await page.evaluate(() => sessionStorage.getItem('firstText'))
  expect(firstText, 'the first render').toMatch(/[а-яё]/i)
  expect(firstText, 'the first render').not.toMatch(/[a-z]+\.[a-z]+/i)
  expect(languageFiles).toEqual(['ru'])

  await page.getByRole('radiogroup', { name: 'Язык' }).getByRole('radio', { name: 'English' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  expect(languageFiles).toEqual(['ru', 'en'])
  expect(refused).toEqual([])
})
