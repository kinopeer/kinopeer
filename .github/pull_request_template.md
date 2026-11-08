<!-- Everything here is in English. Delete the sections and hints that don't apply.
     Contributing from outside? Fill in what you can; the maintainer completes the rest (CONTRIBUTING.md). -->

By opening this pull request, I agree to [CONTRIBUTING.md → Licensing of contributions](https://github.com/kinopeer/kinopeer/blob/main/CONTRIBUTING.md#licensing-of-contributions).

## What

<!-- What changes for the user or in the code, and why. Link the issue (Closes #…) when there is one. -->

## Tests

<!-- One row per new or changed test. Layer: its number and name from docs/TESTING.md → Layers,
     the lowest that sees it: 1 Pure logic, 2 Components and generic hooks, 3 Screens, stores and
     clients, 4 Server, 5 Integration, 6 Browser ("3, screens, stores and clients"). A screen test
     that re-checks a sort's order or a component's own behavior is a duplicate. Seen red: what you
     broke and watched it fail, one break per claim of its title and of each comment on its
     assertions (docs/TESTING.md → A test that can fail). The review (/test-review) reads this first. -->

| Test (file › it) | Layer | What it says | Seen red (one break per claim) |
| --- | --- | --- | --- |
|  |  |  |  |

Not covered: <!-- each part of the diff without a test: the part — an accepted reason
     (docs/TESTING.md → Saying why something is uncovered) — the specifics: what was looked at on
     the stand or measured, the blind spot and every environment it runs in, the `it` that covers
     it. Or "nothing". -->

Neighbours: <!-- docs/TESTING.md → Choosing a layer. Answer each with the `it` that covers it and
     what you broke for exactly that case to see it red, a reason from Not covered, or "doesn't
     apply" and why. A test that stays green with that case broken doesn't answer it. -->

- Another place:
- Later:
- Meanwhile:
- The next poll:
- The edges:

Mutants: <!-- npm run test:mutants at the commit you mark ready: the count, then each survivor —
     test added | an accepted reason | equivalent, and why. Or "nothing to mutate". -->

Broken by hand: <!-- what Stryker leaves alone in the changed lines (docs/TESTING.md → A test that
     can fail): each dependency dropped from an effect or memo, each operand of a condition, each
     alternative in a selector, which value a guard reads, a prop passed down — and the `it` that
     failed. Or "none in the diff". -->

Baselines: <!-- each changed or new PNG — what changed and why — diff looked at | re-rendered with
     --update-snapshots=all | new, opened. Or "none". -->

## Docs

<!-- What changed in the docs, or "none". The docs are every file that describes what the diff
     changes: CLAUDE.md and the files in its docs table (README, CONTRIBUTING, SECURITY, SPEC,
     ARCHITECTURE, ROADMAP, DEVELOPMENT, TESTING, RELEASE_CHECKLIST, CHANGELOG), the review skill
     in .claude/skills/, and this template, the workflows and the config, whose comments are docs
     too, with .env.example. Search them for what the diff moved or renamed: which test owns a
     statement, what a sheet or a toast does. Grep the whole tree for each number or name the diff
     changes, by its old value and each word of an old name on its own (`git grep -n -I '380px'
     -- ':!package-lock.json'`, `git grep -ni kinoseed`, not only `kinoseed-tmdb`). Read their paragraphs
     about what the diff changes: a claim by meaning ("as in Downloads, on both layouts") has no
     name to grep. Check each claim against what it describes: the code, the service's own docs
     (opened, not remembered), the UI's words, the doc it points at; a checklist step's pointer
     resolves and its check can pass as written. A list the change adds to gains the new item:
     the screens in TESTING.md → Screenshot tests, SPEC's decision log (newest first), the blind
     spots. Bring this section, What and Tests to the head after each round's fixes. -->

## Why tests missed it

<!-- fix/ PRs and fixes of a flaky test; delete the section otherwise. docs/TESTING.md → When we find a bug. -->

Class: `test-gap:<uncovered | wrong-layer | implementation | fake-drift | environment | silent-test | flaky>`, also the label on the issue.

What changes so this class is caught:
