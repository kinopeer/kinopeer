---
paths:
  - "src/releases/**"
  - "src/search/**"
  - "src/torrents/**"
  - "src/logic/**"
  - ".oxlintrc.json"
---

# Pure logic: the modules that depend on neither React nor the platform

Parsing, filtering and computations, the rules Kinopeer applies to its data, live in modules that depend on neither React nor the platform, so they are tested without an environment and can move between the browser, the server and other clients. They are every module in `src/releases/`, `src/search/`, `src/torrents/` and `src/logic/` (logic that more than one area shares, such as the sort order, `withTimeout` and the shared requests) but the tests, the hooks (`use` and a capital letter: `useMainData.ts`) and the providers (`MainDataProvider.tsx`, `TorrentRequestsProvider.tsx`), which keep React's state beside the logic. Code that needs React or the browser goes into such a hook with the state it keeps, as `useTitleMatches.ts` holds the title lookups and their localStorage cache over the rules in `titleLookup.ts`, and `useServerMatches.ts` reads the store in `serverMatches.ts`; any other component goes into `src/components/` or `src/screens/`, since a `.tsx` in those folders is checked as the rest. oxlint holds the boundary in the override of `.oxlintrc.json` for those folders, whose cases are in `src/logic/pureModules.test.ts`, so a new file there is checked from the start:

- `no-restricted-imports` refuses React, React DOM, React Router and react-i18next, even for a type, and every Node built-in: each name Node's `builtinModules` lists, its subpaths and its `node:` form. It also refuses a hook, a screen or a component (a module named `use` and a capital letter, matched with its case, anything under `screens/` or `components/`), which brings React in, unless only its types are imported.
- `no-undef` refuses every global but the language's own and the ones the override's `globals` names, which every platform has: `fetch` with `Headers`, `Request` and `Response`, `AbortController`, `URL`, `TextEncoder`, Web Crypto's `crypto`, the timers, `queueMicrotask`, `structuredClone` and `console`. It reads `typeof` too, so `typeof window !== 'undefined'` is refused as well. So `window`, `document`, `localStorage`, `navigator`, `process`, `Buffer` and the rest of the browser and Node are refused, and so is a constant the build defines, such as `__APP_VERSION__`: the caller passes in what it needs. `no-restricted-globals` refuses `globalThis`, through which any of them could be read.
- `react/react-in-jsx-scope` refuses JSX, which React's automatic runtime would otherwise compile without an import.
- i18next itself and the app's API clients stay allowed.

What the rule doesn't see is left to review. It reads a module's own imports only, so one that imports a module outside these folders that uses React or the browser passes: `src/lib/format.ts`, which some of them import a type from, uses React. A pure helper that sits beside the one component or service it serves (`sheetDrag.ts` by `Sheet`, `isTabOn.ts` by `TabBar`, `swRoutes.ts` by the service worker) is outside those folders and isn't checked, and neither are the pure modules of `src/lib/` that serve the interface (`cx.ts`, `breakpoints.ts`, `links.ts`). A hook or a provider may use React by design, so neither is checked.
