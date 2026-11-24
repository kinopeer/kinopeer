# Kinopeer

A qBittorrent web UI built around movies and TV series. Find a title in TMDB, pick a release via Prowlarr, send it to qBittorrent, and manage downloads. No playback. Mobile-first PWA with a desktop layout. Installs on umbrelOS and the other ways listed under Product.

## Product

- Core principle: find a title, pick a release and download it without leaving Kinopeer.
- Not doing: playback, Sonarr/Radarr-style automation (watchlists, RSS, new episodes), a season picker on the series page, tracker logins or getting around site protection, Jackett, telemetry. Installs are supported on Umbrel, with the repository's `docker-compose.yml`, as the image on its own next to a qBittorrent and a Prowlarr the user runs (TrueNAS and CasaOS through it, Unraid through its Community Applications template, `unraid/kinopeer.xml`), and as qBittorrent's Alternative WebUI, from the `kinopeer-webui.zip` each release carries.
- What each screen does and the log of product decisions: `docs/SPEC.md`.

## Docs

| File | What's in it |
| --- | --- |
| `README.md` | For users: features, how to install each supported install (Product, above) and how the installs differ |
| `CONTRIBUTING.md` | For outside contributors: where ideas, bugs and PRs go, the checks, how the project is developed, the licensing of contributions |
| `SECURITY.md` | Supported versions and reporting a vulnerability privately |
| `docs/SPEC.md` | What the product does and doesn't, decision log |
| `docs/ARCHITECTURE.md` | The map of how the app is built, area by area (imported into this file, below), and the rules that reach outside their area |
| `.claude/rules/architecture/` | Each area of the architecture, a file each, loaded into a session when it reads or edits a file the area covers |
| `.claude/rules/design.md` | How styles and layout are written in code, loaded with any stylesheet or component |
| `.claude/rules/ci.md` | CI, Dependabot, the checks guard and the mutants, loaded with the workflows, the scripts and the checks' config |
| `docs/COORDINATOR.md` | What changes while a task is on autopilot |
| `docs/DEVELOPMENT.md` | Running locally, environment variables, releases, the Umbrel package |
| `docs/TESTING.md` | The test layers and how to choose one, what to do with a bug (the seven `test-gap` classes), fixtures and fakes, the check that every place showing a service's failure names the link that failed, coverage and its threshold, reviewing a PR's tests and tagging its findings (its rules also the quality system's testing component, of which it is the source), the screenshot tests, the smoke journeys, the blind spots |
| `docs/QUALITY.md` | Which parts of the quality system are in force, and the checks guard: what it marks in a PR (what weakens the checks, design values, changes to existing checks), `checks.json`, how it runs; the budgets; the actual values the measuring jobs record for the dashboard; the retro of the whole quality system every fifty merged PRs, with its table of past retros |
| `docs/RELEASE_CHECKLIST.md` | What to check before every release |
| `CHANGELOG.md` | User-facing changes per version |

## Stack

- Vite + React 19 + TypeScript (strict), Node.js 22.18+ (the tests: 22.22.2+, 24.15+ or 26+, jsdom's range)
- oxlint for linting
- Vitest + Testing Library (jsdom) for tests
- Playwright screenshot tests (`e2e/`), run in the Playwright Docker image, where axe (`@axe-core/playwright`) reads the state each screenshot shows against its accessibility budget (`e2e/test.ts`), and smoke journeys through the production server (`e2e/smoke/`), run on the host locally and in that image in CI, and the WebUI's smoke journeys through a real qBittorrent serving the WebUI build (`e2e/webui/`), in Docker locally and in CI
- CI on GitHub Actions, Dependabot, the checks guard and Stryker's mutants: `.claude/rules/ci.md`, which Claude Code loads with the workflows, the scripts and the checks' config.

## Commands

```sh
npm run dev        # dev server at http://localhost:5173
npm test           # Vitest, single run
npm run test:coverage  # the same with a coverage report and its threshold
npm run test:mutants   # breaks the lines this branch changes, lists the breaks no test noticed
npm run guard          # the checks guard over this branch's commits: what weakens the checks, changes existing ones or adds a design value
npm run lint       # oxlint
npm run typecheck  # tsc -b
npm run build      # production build into dist/
npm run build:webui  # the Alternative WebUI build into dist-webui/public/, for qBittorrent's Alternative WebUI set to dist-webui/, failing on a string qBittorrent would replace
npm run size       # the build's JS and CSS gzipped and the rest, against their budgets in checks.json
npm run test:requests  # each screen's requests on opening and each move's between screens, against their budgets in checks.json, and each screen's layout shift on a phone and on desktop (after npm run build)
npm start          # production server (server/main.ts) serving dist/
npm run test:visual         # screenshot tests in Docker, each screenshot's state read by axe against its accessibility budget in checks.json
npm run test:visual:update  # re-render their baselines
npm run test:smoke          # smoke journeys in Chromium through the production server, no Docker
npm run test:smoke:webui    # the WebUI's smoke journeys through a real qBittorrent 5.2.0, in Docker
```

What to run before pushing, and when each check applies, is in `docs/DEVELOPMENT.md` → Before pushing; `npm run guard` shows what the checks guard will mark in the PR. CI must be green before merge.

## Architecture

How the app is built, area by area, is in `.claude/rules/architecture/`, written for contributors, a file per area, which Claude Code loads when a session reads or edits a file the area covers. Its map, `docs/ARCHITECTURE.md`, is imported here, so every session reads it whole:

@docs/ARCHITECTURE.md

## Conventions

- Everything in the repo and on GitHub is in English: code, comments, docs, commit messages, PR titles and descriptions, issues.
- Nothing in the repo or on GitHub names a real tracker or indexer, links a real release or torrent page, or uses a real release group's name: not in code, comments, test data, screenshots, docs, commits, PRs, issues or Discussions. A public torrent client that points at specific trackers and uploads invites takedown notices. Test data uses `Indexer A`, `Indexer B`…, URLs on `example.org`, `example.com` or `.test`, and made-up groups (`-GRPA`); a release name keeps a real naming style with a movie's title, which is TMDB data. A fact about how some indexers behave says "some indexers". The one exception is product logic that has to know a name, such as the voice-over studios `parseRelease` recognizes, with its own test (`docs/TESTING.md` → Shared test data).
- UI copy is localized (Russian and English) with i18next. Never hardcode user-facing strings: add keys to both `src/i18n/locales/en.json` and `ru.json` (a test checks they match). oxlint refuses a string that is a whole child in the app's JSX or the quoted value of an attribute a user reads or hears (`react/jsx-no-literals` in `.oxlintrc.json`, with its cases in `src/i18n/texts.test.ts`); a string in braces in an attribute (`aria-label={'Close'}`), inside an expression (`{busy ? 'Pause' : 'Resume'}`) or outside JSX (a toast's message) passes it and is left to review. Russian plurals need `_one`, `_few`, `_many` and `_other` keys.
- One meaning, one key. Before adding UI copy, search `src/i18n/locales/en.json` for the same meaning, not only the same words: if it's there, use its key, and a text that includes it as a whole sentence nests it with `$t(key)` rather than repeating it (a fragment nested into another sentence breaks Russian grammar; `src/i18n/locales.test.ts` checks every nested key exists). A new key that words the same meaning differently, shorter for a tight spot say, is the exception, and its PR says why the existing one didn't fit (#312, where a hint was written three ways before it became one key).
- Work in small, reviewable PRs, one issue or less each. A PR's title says its kind with a prefix, `feat:`, `fix:`, `chore:` or `docs:`, which the squash merge keeps in `main`'s log; the branch's name is free (Claude Code names its own `claude/…`). Once the deputy has approved a PR, it takes only fixes of what it already does: a new request, the owner's included, is a PR of its own from `main` after this one merges (#336, where 10 of 19 findings came after its first verdict, from three commits of new requests and their fixes).
- Never push to `main` directly; open a PR. Every PR targets `main`, never another feature branch: PRs squash-merge by themselves, often several in a row, and a stacked PR would land in its stale base. Work that depends on an open PR waits for it to merge, then rebases onto `main`. Open a PR as a draft and, once the author's checks are done, mark it ready and turn on auto-merge, each time it's marked ready: a PR opened ready wakes no deputy. It then merges once the deputy approves it and its checks pass (`docs/TESTING.md` → Reviewing a PR's tests).
- Before starting, say so if a request is suboptimal by any measure (performance, maintainability, developer experience, workarounds in code, security, UX, cost, complexity): name the risks and the alternatives, and let the owner decide. Product decisions aren't fixed: the owner is ready to revise one or drop a feature for performance, developer experience or other technical gains, so when changing the product is the better trade-off, offer that as an alternative too.
- While working, too: when a task grows past what it was expected to be (a change of a few lines needs new hooks or workarounds, each fix uncovers the next problem, review rounds keep finding bugs in the same new mechanism), stop and ask the owner before going on, a session started by another through its coordinator (on autopilot the coordinator decides: `docs/COORDINATOR.md`). Say what it grew into (lines, new mechanisms, what will need maintaining), what it gains (numbers), and the options, a simpler version and dropping it included. A risk named in the task is a reason to weigh its cost, not to fix it at any price (#252, closed unmerged: +514 lines of frame-timed hooks and clipping workarounds for a gain seen only on a throttled CPU).
- A heuristic (the app guessing the environment, the network or a setup from indirect signs) gets its scope in the PR's description before round 1 (the template's `A heuristic's scope` line): which cases it recognizes and where it says nothing, and in a doubtful case it says nothing rather than advise. A case a review finds outside that scope: where the heuristic advises wrong, it's a bug of the PR, fixed in it, red test first; where it says nothing and the case is rare, the PR doesn't grow for it: the case goes to an idea in Discussions → Ideas and to the known limits in the PR's row of `docs/SPEC.md`'s decision log, linked; where it says nothing in a common setup (a platform or an install the docs support, with its defaults), the review asks under **For the coordinator** whether to widen the scope in this PR or ship without it (which puts the case among the known limits and the ideas, as a rare one), and the coordinator weighs how common the case is against another round. A missing hint leaves the person to look for the cause; a wrong one sends them the wrong way (#518, where three rounds in a row each found a new case of the container-network detection, Docker in LXC the last, and each case widened the mechanism and drew the next round).
- Feature ideas, ours included, go to GitHub Discussions → Ideas, so they can be upvoted. Issues are for bugs and for work we've decided to do. A deferred issue is closed as not planned with a link to its idea.
- Keep the docs current: when a change affects them, update them in the same PR. Behavior or a product decision → `docs/SPEC.md` (and its decision log); a shipped issue → the PR closes it (`Closes #N`); setup, environment variables or releases → `docs/DEVELOPMENT.md`; user-visible changes → `CHANGELOG.md` and, if needed, `README.md`; architecture → its area's file in `.claude/rules/architecture/` (`docs/ARCHITECTURE.md` → Keeping it current).
- The plan is GitHub's milestones, one per version (`gh api repos/kinopeer/kinopeer/milestones`), each with the issues it ships, and `CHANGELOG.md` what shipped when; anything to settle before a version is an issue in its milestone. `docs/RELEASE_CHECKLIST.md` lists what to check before every release.
- Keep Kinopeer runnable without its server: a qBittorrent Alternative WebUI (its own milestone) is planned. A new server feature either has a browser fallback (as torrent-to-title matches do) or is an extra the app works without, and pure logic (name and release parsing, picking a title) imports no React, DOM or Node APIs (where it lives and the lint check that holds it: `.claude/rules/architecture/pure-logic.md`).
- Every PR covers what it changes with tests, each statement on one layer, the lowest that sees it (`docs/TESTING.md` → Choosing a layer): tests sit next to the code as `*.test.ts(x)`, query by role and accessible name. A change without a test says why in the PR's Tests section, with one of the accepted reasons (`docs/TESTING.md` → Saying why something is uncovered); "later" or "trivial" aren't reasons. A flaky test is fixed or deleted, never retried. Before marking a PR ready, its author (for an outside contributor's PR, the maintainer's session: `docs/TESTING.md` → Reviewing a PR's tests) runs `npm run test:mutants` and accounts for each survivor in the PR, runs `/code-review` in a fresh context, fixing each bug it finds red test first and fixing or declining the rest, sees every new or changed test fail with the code it covers broken, and fills the Tests table (`docs/TESTING.md` → A test that can fail). Before it merges, the deputy reviews it (`.claude/skills/deputy/`): a round each time the PR is marked ready for review, with `/test-review` (`.claude/skills/test-review/`, which reads the Tests section first) and `/code-review`, posted as a GitHub review at the commit it saw. The author answers each round with a `Fixes for round <n>` comment and marks the PR ready again (`docs/TESTING.md` → Reviewing a PR's tests). A bug `/code-review` finds in the PR's own change is fixed in that PR, red test first. Review findings are tagged so the retro after every fifty merged PRs can fix the rules where findings repeat (`docs/TESTING.md` → Improving the system, the retro itself in `docs/QUALITY.md` → The retro).
- A bug that reached `main` (found on the test stand, on Umbrel or by a test) is an issue of the Bug type first, with its steps, environment and a `test-gap:*` label, then a red test on its layer, then the fix; the PR's "Why tests missed it" section names the class (`docs/TESTING.md` → When we find a bug). Behavior that works as `docs/SPEC.md` describes it but turned out a poor choice is a Feature, without that procedure (the same section). A problem of the tests, CI or the development tools that no user meets, such as a flaky test, is a Task, still with a `test-gap:*` label when the tests missed it (the same section).
- The speed budgets in `checks.json` aren't raised to get a PR through: a build over a size budget finds what grew and makes it smaller or leaves it out (`docs/QUALITY.md` → The size budget), a screen over a requests budget finds what sends the new request and takes it out (`docs/QUALITY.md` → The requests budget), and a screen over a layout shift budget finds what moves (the failure names the elements) and keeps it in place or keeps room for what loads later (`docs/QUALITY.md` → The layout shift budget), and no layout shift budget goes over 0.1: a screen that moves more has a bug to fix. The deputy accepts a raise only with the measurement and why the budget can't be met otherwise, and with no more room than the budget's section gives (`docs/QUALITY.md` → The size budget, about 5% above the measurement, and the budgets after it). A screen under its requests budget lowers the budget to the new count in the same PR.
- A PR that changes how a screen covered by the screenshot tests looks updates its baselines in the same PR and lists the changed screens: `docs/TESTING.md` → Screenshot tests.
- Accessibility basics are a requirement: real `<button>`/`<a>`/`<input>`, labels on icon-only buttons, touch targets ≥ 44px, `prefers-reduced-motion` respected. Keyboard navigation and focus management (tab order, where focus goes when something opens or closes) aren't a goal for now. Focus rings show only on keyboard navigation: style them with `:focus-visible` and `outline: var(--focus-ring)`, which `src/lib/inputModality.ts` turns off after a click or tap, since browsers also match `:focus-visible` when a dialog opens or the app moves focus.

## Design

- The design lives in Claude Design: the Kinopeer canvas (screens for mobile, desktop, states; a reference as of 0.4.0, no longer kept in sync) at https://claude.ai/code/artifact/d36cd9ea-367d-40f4-9cca-b5ae066c5c19 and the Kinopeer design system (tokens, components, README) at https://claude.ai/artifact/Hezz9q11HdhKm5P2bW3MTn.
- The design system's `tokens.json` is the source of truth for colors, type, spacing, radii, shadows and motion. Use the CSS custom properties, never raw hex values in components.
- The canvas shows how a screen should look, not how to build it. Implement a design the way the codebase does things: tokens, the wrapper's `gap`, shared components and existing patterns, never the canvas's inline styles, pixel values or element structure. Match the look, not the markup.
- How styles and layout are written (spacing and radii tokens, the type roles, `gap`, the desktop layout and its offsets, the font's figures): `.claude/rules/design.md`, which Claude Code loads with any stylesheet or component. The overlays (`Sheet`, `Dialog`, `Accordion`, `Popover`, `Menu`): `.claude/rules/architecture/screens.md` → Overlays.
- Dark theme is primary; light and "follow system" are supported.
- One accent color (teal). Status colors are separate from the accent; "downloading" is the only status in the accent color.
- The app, not the canvas, is the reference for how screens look and behave: changes are built in code and shown on the test stand, and the canvas isn't updated. Draw on the canvas only when the owner asks for it, e.g. to compare variants of a new screen side by side.

## Workflow

- The author and the deputy hand rounds to each other through the PR (`docs/TESTING.md` → Reviewing a PR's tests); Auto-fix on the PR wakes the author's session on each review. The coordinator (the session that hands out the PRs, or where none does a fresh one: the `deputy` skill → The round) takes part only in the deputy's **For the coordinator** questions and in Dependabot's PRs, which it brings to the deputy itself (the `deputy` skill → Dependabot's PRs).
- A change to the docs, the rules sessions work by included, is written in English and reviewed by the deputy as any other PR (the `deputy` skill → The owner's approval). A draft of the wording in Russian goes to the owner only when the owner asks for a rule change themselves: the session shows it and waits for the owner's approval before it writes the English text and opens the PR. An outside contributor with a big change opens an issue or an idea first, as `CONTRIBUTING.md` says.
- The test stand is the dev server (`npm run dev`, port 5173) on the owner's machine, running the branch under review. Start it only when the owner asks to try a branch, and stop it when they're done. Don't leave detached processes (nohup, launchd) running there. In the Claude desktop app, start it as the `dev` configuration in `.claude/launch.json` (`dev-lan` is the same with `--host`, so the owner can open it on a phone at the Mac's LAN address; `preview` runs `npm run preview` on port 4173 after a build, and `preview-lan` the same with `--host`, for a PR that changes a phone screen, since the dev server has no manifest, so what it adds to the Home Screen isn't the installed app); no secrets go in that file.
- A release follows `docs/DEVELOPMENT.md` → Releasing: a PR with the version, the `CHANGELOG.md` section and the "as of version" line at the top of `docs/SPEC.md`; after it merges, the `v*` tag (pushed from the owner's machine, because the cloud git proxy refuses tag pushes); then a PR to the store repo with the new version, release notes and image digest. Tagging and the store PR need the owner's go-ahead.

### Autopilot

The owner may hand a whole task to a coordinator session and step back. A task is on autopilot only when the owner says so in their own words in the coordinator's chat, and until the coordinator's final report; a session the coordinator starts learns it from its brief. Without autopilot nothing here applies.

What changes on autopilot (merging, deciding, and what stays with the owner) is in `docs/COORDINATOR.md`, which the coordinator reads whole once a task is on autopilot, and a session it starts once its brief says so. A secret's value is entered only by the owner and never goes through the chat. No session posts an owner's approval in the owner's place, or merges a PR the deputy hasn't approved.
