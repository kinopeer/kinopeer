import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_COLORS, THEME_STORAGE_KEY } from './theme'

/**
 * public/theme.js, which index.html runs before first paint: a file of its own, since the
 * Content-Security-Policy runs no inline script. It can't import theme.ts, so its keys and colors
 * are checked against it here.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const runScript = () => new Function(read('public/theme.js'))()

function prefersLight(light: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: light && query === '(prefers-color-scheme: light)' }))
}

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#000000" />'
  delete document.documentElement.dataset.theme
})

afterEach(() => localStorage.clear())

const themeColor = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content

describe('theme.js', () => {
  it.each([
    ['a saved light theme', 'light', false, 'light'],
    ['a saved dark theme on a light system', 'dark', true, 'dark'],
    ['the system’s light theme', 'system', true, 'light'],
    ['the system’s dark theme', 'system', false, 'dark'],
    ['nothing saved on a light system', null, true, 'light'],
  ] as const)('applies %s with its browser color', (_, saved, systemLight, theme) => {
    if (saved) localStorage.setItem(THEME_STORAGE_KEY, saved)
    prefersLight(systemLight)

    runScript()

    expect(document.documentElement.dataset.theme).toBe(theme)
    expect(themeColor()).toBe(THEME_COLORS[theme])
  })

  it('leaves the page as it is when storage can’t be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(runScript).not.toThrow()
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(themeColor()).toBe('#000000')
  })
})

describe('index.html', () => {
  const page = new DOMParser().parseFromString(read('index.html'), 'text/html')

  it('runs no inline script, which the Content-Security-Policy would block', () => {
    const scripts = [...page.querySelectorAll('script')]
    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) expect(script.getAttribute('src'), script.outerHTML).toBeTruthy()
  })

  it('runs theme.js in the head, blocking, so the theme applies before first paint', () => {
    const script = page.head.querySelector('script[src="/theme.js"]')
    expect(script).not.toBeNull()
    expect(script!.hasAttribute('defer') || script!.hasAttribute('async') || script!.getAttribute('type') === 'module').toBe(false)
  })
})
