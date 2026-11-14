import type { Locator, Page } from '@playwright/test'
import { expect, test } from './test.ts'
import { openApp, settle } from './app.ts'

/**
 * Reduced motion, which every test here runs with (playwright.config.ts): asking for less motion
 * never gives more of it than the default. A style change on an element that stays shows in the
 * frame it comes in, where a transition, however short, draws that frame with the old value (#390:
 * a page drawn 118px up for a frame). jsdom has no transitions, so this is a browser's to see.
 */
test.describe('reduced motion', () => {
  /** Changes the element's style and reads, before the next frame, what it shows and what animates it. */
  async function change(element: Locator, property: 'marginTop' | 'transform', value: string) {
    return element.evaluate(
      (node: HTMLElement, { property, value }) => {
        // Its style taken before the change, so the change is one a transition could start from.
        void getComputedStyle(node)[property]
        node.style[property] = value
        return {
          shown: getComputedStyle(node)[property],
          transitions: node.getAnimations().filter((animation) => animation instanceof CSSTransition).length,
        }
      },
      { property, value },
    )
  }

  /** A plain element the test adds to the page, with `transition` as its inline style, if given. */
  async function plainElement(page: Page, transition = '') {
    await openApp(page, '/')
    await settle(page)
    await page.evaluate((transition) => {
      const plain = document.createElement('div')
      plain.dataset.testid = 'plain'
      plain.style.transition = transition
      document.body.append(plain)
    }, transition)
    return page.getByTestId('plain')
  }

  test('a style change on an element that declares no transition shows at once', async ({ page }) => {
    const plain = await plainElement(page)
    expect(await change(plain, 'marginTop', '100px')).toEqual({ shown: '100px', transitions: 0 })
  })

  // As the grid card's Pause button declares for its blur, which goes once the button has faded out
  // (DownloadsScreen.css): a jump after a delay is a transition that shows the old value until then.
  test('a transition of no length after a delay is cut out too', async ({ page }) => {
    const plain = await plainElement(page, 'margin-top 0s linear 200ms')
    expect(await change(plain, 'marginTop', '100px')).toEqual({ shown: '100px', transitions: 0 })
  })

  test("a sheet's own transition is cut out: dragged down by a script, it shows there at once", async ({ page }) => {
    await openApp(page, '/')
    await page.getByRole('button', { name: 'Сортировка: Приоритет' }).click()
    const sheet = page.getByRole('dialog', { name: 'Сортировка и фильтр' })
    await expect(sheet).toBeVisible()
    await settle(page)
    // Its opening slide over, so only the change below can animate it.
    await expect.poll(() => sheet.evaluate((node) => node.getAnimations().length)).toBe(0)
    expect(await change(sheet, 'transform', 'translateY(100px)')).toEqual({
      shown: 'matrix(1, 0, 0, 1, 0, 100)',
      transitions: 0,
    })
  })
})
