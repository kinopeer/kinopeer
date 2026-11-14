import type { Page } from '@playwright/test'
import { expect, test } from './test.ts'
import { openApp, settle } from './app.ts'

/**
 * Reduced motion, which every test here runs with (playwright.config.ts): asking for less motion
 * never gives more of it than the default. A style change on an element that stays shows in the
 * frame it comes in, where a transition, however short, draws that frame with the old value (#390:
 * a page drawn 118px up for a frame). jsdom has no transitions, so this is a browser's to see.
 */
test.describe('reduced motion', () => {
  /** Changes `element`'s style and reads, before the next frame, what it shows and what animates it. */
  async function change(page: Page, selector: string, property: 'marginTop' | 'transform', value: string) {
    return page.evaluate(
      ({ selector, property, value }) => {
        const element = document.querySelector<HTMLElement>(selector)
        if (!element) throw new Error(`Nothing matches ${selector}`)
        // Its style taken before the change, so the change is one a transition could start from.
        void getComputedStyle(element)[property]
        element.style[property] = value
        return {
          shown: getComputedStyle(element)[property],
          transitions: element.getAnimations().filter((animation) => animation instanceof CSSTransition).length,
        }
      },
      { selector, property, value },
    )
  }

  test('a style change on an element that declares no transition shows at once', async ({ page }) => {
    await openApp(page, '/')
    await settle(page)
    await page.evaluate(() => {
      const plain = document.createElement('div')
      plain.id = 'plain'
      document.body.append(plain)
    })
    expect(await change(page, '#plain', 'marginTop', '100px')).toEqual({ shown: '100px', transitions: 0 })
  })

  test("a sheet's own transition is cut out: dragged down by a script, it shows there at once", async ({ page }) => {
    await openApp(page, '/')
    await page.getByRole('button', { name: 'Сортировка: Приоритет' }).click()
    await expect(page.getByRole('dialog', { name: 'Сортировка и фильтр' })).toBeVisible()
    await settle(page)
    // Its opening slide over, so only the change below can animate it.
    await page.waitForFunction(() => document.querySelector('.ks-sheet')!.getAnimations().length === 0)
    expect(await change(page, '.ks-sheet', 'transform', 'translateY(100px)')).toEqual({
      shown: 'matrix(1, 0, 0, 1, 0, 100)',
      transitions: 0,
    })
  })
})
