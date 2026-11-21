// The order Vitest runs test files in when it runs only those related to some files, as Stryker
// does for each mutant (stryker.config.mjs). A static mutant, one that acts as its module loads,
// runs every test related to its file until one fails (#520): a file the Vite config imports, as
// every module under server/ is, has the whole suite related, and Vitest's own order puts the
// longest files first. So a file's own tests go first, by name: `container.test.ts` and
// `integration/container.test.ts` for `container.ts`, which are the ones that kill such a mutant.

/** A file's name without its folders, `.test` and extension: `container` for `server/container.ts`. */
export function stem(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.replace(/(\.test)?\.[^.]+$/, '')
}

/**
 * `files` in their order with those named after one of `related` moved to the front, each group
 * keeping the order it had. With nothing related, `files` as they are.
 */
export function relatedFilesFirst<T>(files: readonly T[], related: readonly string[], pathOf: (file: T) => string): T[] {
  const stems = new Set(related.map(stem))
  const first = files.filter((file) => stems.has(stem(pathOf(file))))
  return [...first, ...files.filter((file) => !first.includes(file))]
}
