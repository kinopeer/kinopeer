# Contributing

- **An idea or a missing feature:** post it in [Discussions → Ideas](https://github.com/kinopeer/kinopeer/discussions/categories/ideas), where people upvote them. Search for it first.
- **A bug:** [report it](https://github.com/kinopeer/kinopeer/issues/new?template=bug_report.yml) with the steps and your versions.
- **A question:** ask in [Discussions → Q&A](https://github.com/kinopeer/kinopeer/discussions/categories/q-a).
- **A vulnerability:** privately, as [SECURITY.md](SECURITY.md) says.

Read first [what Kinopeer doesn't do](docs/SPEC.md#what-kinopeer-doesnt-do): playback, Sonarr- and Radarr-style automation, tracker logins and the like. Pull requests for those won't be merged, but an idea in Ideas is welcome: product decisions aren't final.

## Pull requests

Pull requests are welcome. A small fix can come straight away; for anything bigger, open an issue or an idea first, so we agree on the approach before you spend the time. Target `main`, one change per PR.

The pull request template is long: a table of tests, mutants and more. Fill in what you can. The maintainer completes the rest before merging (tests in the project's system, mutants, review rounds), possibly with commits to your branch.

## Running and checking

Setup is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Before pushing, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`, and `npm run test:visual` (in Docker) when the UI changes. CI runs the same on every PR.

- UI text is never hardcoded: add keys to both `src/i18n/locales/en.json` and `ru.json`. If you don't know Russian, put the English text in both, and the maintainer will translate it.
- Everything in the repository is in English: code, comments, docs, commit messages.
- The architecture and conventions are in [CLAUDE.md](CLAUDE.md), the tests in [docs/TESTING.md](docs/TESTING.md).

## How Kinopeer is developed

Kinopeer is written with [Claude Code](https://claude.com/claude-code). The maintainer sets the tasks, reads the changes and decides what merges. Every PR is reviewed by a separate Claude session by the rules in `docs/TESTING.md`, hence the review rounds in the PRs' comments, and `CLAUDE.md` describes the project for those sessions. If you work with Claude Code yourself, it gives your session the same context. Whether you write code with AI is up to you; the bar is the same either way: the tests and the review.

## Licensing of contributions

Kinopeer is licensed under the [GNU GPL, version 3 or later](LICENSE). By submitting a contribution, you:

- license it under the same terms;
- grant Alfred Shakhov a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, modify and distribute it under other licenses as well, commercial ones included;
- confirm that you have the right to do so.
