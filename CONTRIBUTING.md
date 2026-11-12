# Contributing

- **An idea or a missing feature:** post it in [Discussions → Ideas](https://github.com/kinopeer/kinopeer/discussions/categories/ideas), where people upvote them. Search for it first.
- **A bug:** [report it](https://github.com/kinopeer/kinopeer/issues/new?template=bug_report.yml) with the steps and your versions.
- **A question:** ask in [Discussions → Q&A](https://github.com/kinopeer/kinopeer/discussions/categories/q-a).
- **A vulnerability:** privately, as [SECURITY.md](SECURITY.md) says.

Read first [what Kinopeer doesn't do](docs/SPEC.md#what-kinopeer-doesnt-do): playback, Sonarr- and Radarr-style automation, tracker logins and the like. Pull requests for those won't be merged, but an idea in Ideas is welcome: product decisions aren't final.

## Pull requests

Pull requests are welcome. A small fix can come straight away; for anything bigger, open an issue or an idea first, so we agree on the approach before you spend the time. Target `main`, one change per PR.

The pull request template is long: a table of tests, mutants and more. Fill in what you can. The maintainer completes the rest before merging (tests in the project's system, mutants, review rounds), possibly with commits to your branch, so leave "Allow edits by maintainers" on when you open the PR.

Don't name real trackers, link real releases or use real release groups, in code, tests, screenshots, PRs or issues: write `Indexer A`, a URL on `example.org` and a made-up group instead. When a bug depends on a release's name, give its naming style with the tracker and group taken out.

## Running and checking

Setup is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Before pushing, run `npm run lint`, `npm run typecheck`, `npm run test:coverage` (the tests with the coverage threshold), `npm run build` and `npm run size` (the build against its size budgets), `npm run test:smoke` (the smoke journeys in Chromium) when a flow changes, and `npm run test:visual` (in Docker) when the UI changes. CI runs all of them on every PR and also builds the Docker image and starts it.

- UI text is never hardcoded: add keys to both `src/i18n/locales/en.json` and `ru.json`. If you don't know Russian, put the English text in both, and the maintainer will translate it.
- Before adding a text, look in `en.json` for one that already says the same thing, even in other words, and use its key; a text that includes another as a whole sentence nests it with `$t(key)`. A new wording of the same thing is fine when the existing one doesn't fit (too long for its place, say): say why in the PR.
- Everything in the repository is in English: code, comments, docs, commit messages.
- The architecture is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the conventions in [CLAUDE.md](CLAUDE.md), the tests in [docs/TESTING.md](docs/TESTING.md).

## How Kinopeer is developed

Kinopeer is written with [Claude Code](https://claude.com/claude-code). The maintainer sets the tasks, reads the changes and decides what merges. Every PR but Dependabot's is reviewed by a separate Claude session by the rules in `docs/TESTING.md`, hence the review rounds in the PRs' comments, and `CLAUDE.md` describes the project for those sessions. If you work with Claude Code yourself, it gives your session the same context. Whether you write code with AI is up to you; the bar is the same either way: the tests and the review.

## Licensing of contributions

Kinopeer is licensed under the [GNU GPL, version 3 or later](LICENSE). By submitting a contribution, you:

- license it under the GNU GPL, version 3 or later;
- grant Alfred Shakhov and Alfred Shakhov's successors and assigns a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, modify, distribute and sublicense it under other licenses as well, commercial ones included;
- confirm that you have the right to do so.
