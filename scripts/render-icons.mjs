// Renders the app icons in public/icons/ from the SVG sources in scripts/icons/ (drawn after the
// Kinopeer design canvas, "Brand, icons & PWA"). Run it after changing a source:
//
//   npm install --no-save playwright-core && node scripts/render-icons.mjs
//
// Needs a Chromium; set CHROMIUM_PATH if Playwright can't find one.
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const outputs = [
  // Manifest icons: rounded tile for "any", full-bleed art in the 80% safe zone for "maskable".
  { source: 'icon.svg', file: 'icon-192.png', size: 192 },
  { source: 'icon.svg', file: 'icon-512.png', size: 512 },
  { source: 'icon-maskable.svg', file: 'icon-maskable-512.png', size: 512 },
  { source: 'icon-monochrome.svg', file: 'icon-monochrome-512.png', size: 512 },
  // iOS rounds the corners itself and shows transparent ones as black, so its icon is full-bleed.
  { source: 'icon-full.svg', file: 'apple-touch-icon.png', size: 180 },
]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
const page = await browser.newPage()
for (const { source, file, size } of outputs) {
  const svg = await readFile(new URL(`icons/${source}`, import.meta.url))
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<style>body{margin:0}img{display:block}</style><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${svg.toString('base64')}">`,
  )
  await page.locator('img').screenshot({ path: `public/icons/${file}`, omitBackground: true })
  console.log(`public/icons/${file}`)
}
await browser.close()
