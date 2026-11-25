import { defineConfig } from '@playwright/test'
import readme from './playwright.readme.config.ts'

/**
 * The README's demo (`npm run demo:readme`): e2e/readme.demo.ts on the dev server, as the README
 * screenshots are taken, recorded as a video that scripts/readme-demo.sh turns into docs/demo.gif.
 */
export default defineConfig({ ...readme, testMatch: 'readme.demo.ts' })
