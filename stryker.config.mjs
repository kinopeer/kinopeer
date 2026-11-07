// Stryker's settings for `npm run test:mutants`. `scripts/mutants.mjs` passes it the lines to mutate,
// so this file says only how: docs/TESTING.md → A test that can fail.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vite.config.ts' },
  reporters: ['json', 'progress-append-only'],
  jsonReporter: { fileName: 'reports/mutants.json' },
  // On the batch of the 2026-10-30 retro these mutators gave most of the noise (a label's text, an
  // empty array in a default) and none of what a review found.
  mutator: { excludedMutations: ['StringLiteral', 'ArrayDeclaration', 'ObjectLiteral', 'OptionalChaining'] },
  timeoutMS: 15000,
  ignorePatterns: ['e2e', 'docs', 'dist', 'coverage', 'data'],
  tempDirName: '.stryker-tmp',
  // A file that doesn't exist, so Stryker skips rewriting tsconfig paths for its sandbox: that rewrite
  // calls TypeScript's JS API, which TypeScript 7 doesn't have (#285, stryker-mutator/stryker-js#6111).
  // Ours don't need it, since every tsconfig sits in the root and points only inside the repo. Drop
  // this line once a Stryker release reads tsconfig files without TypeScript.
  tsconfigFile: 'no-tsconfig-rewrite.json',
}
