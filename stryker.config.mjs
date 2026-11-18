// Stryker's settings for `npm run test:mutants`. `scripts/mutants.mjs` passes it the lines to mutate,
// so this file says only how: docs/TESTING.md → A test that can fail.
import { readFileSync } from 'node:fs'

// The mutators and the tests left out sit in checks.json, as data, so the checks guard (scripts/guard/) marks a PR
// that leaves out more.
const { mutants } = JSON.parse(readFileSync(new URL('./checks.json', import.meta.url), 'utf8'))

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vite.config.ts' },
  reporters: ['json', 'progress-append-only'],
  jsonReporter: { fileName: 'reports/mutants.json' },
  // On the batch of the 2026-10-30 retro these mutators gave most of the noise (a label's text, an
  // empty array in a default) and none of what a review found.
  mutator: { excludedMutations: mutants.excludedMutations },
  timeoutMS: 15000,
  // The tests left out of Stryker's runs come from checks.json, where the guard marks one added, each
  // anchored to its path (gitignore-style, as Stryker reads these), so a later file of the same name
  // elsewhere isn't left out unmarked. Such a test can't run in Stryker's sandbox, a git-ignored
  // folder (checks.test.ts lists the repository's files through git), and can't kill a mutant either (#465).
  ignorePatterns: ['e2e', 'docs', 'dist', 'coverage', 'data', ...mutants.testsLeftOut],
  tempDirName: '.stryker-tmp',
  // A file that doesn't exist, so Stryker skips rewriting tsconfig paths for its sandbox: that rewrite
  // calls TypeScript's JS API, which TypeScript 7 doesn't have (#285, stryker-mutator/stryker-js#6111).
  // Ours don't need it, since every tsconfig sits in the root and points only inside the repo. Drop
  // this line once a Stryker release reads tsconfig files without TypeScript.
  tsconfigFile: 'no-tsconfig-rewrite.json',
}
