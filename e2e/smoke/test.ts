import { expect, test as base } from '@playwright/test'

/**
 * Playwright's `test` for the journeys, failing any that runs into the Content-Security-Policy
 * (server/securityHeaders.ts): what the built app loads and runs comes only from its own files, and
 * only a real browser on the production server shows whether it all still does. Chromium reports a
 * blocked script, style or request on the console; the page's own `securitypolicyviolation` event
 * is logged there too, for what it reports without a message of its own.
 */
export const test = base.extend<{ policyViolations: void }>({
  policyViolations: [
    async ({ context }, use) => {
      const violations: string[] = []
      context.on('console', (message) => {
        if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) violations.push(message.text())
      })
      await context.addInitScript(() =>
        document.addEventListener('securitypolicyviolation', (event) =>
          console.error(`Content Security Policy: ${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`),
        ),
      )
      await use()
      expect(violations, 'what the Content-Security-Policy blocked').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
