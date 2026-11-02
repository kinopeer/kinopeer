<!-- Everything here is in English. Delete the sections and hints that don't apply. -->

## What

<!-- What changes for the user or in the code, and why. Link the issue (Closes #…) when there is one. -->

## Tests

<!-- One row per new or changed test. Layer: its number and name from docs/TESTING.md → Layers
     ("3, screens, stores and clients"). Seen red: you broke the code it covers and watched it fail
     (docs/TESTING.md → A test that can fail). The review (/test-review) reads this first. -->

| Test (file › it) | Layer | What it says | Seen red |
| --- | --- | --- | --- |
|  |  |  |  |

Not covered: <!-- each part of the diff without a test, the neighbours of the change included
     (docs/TESTING.md → Choosing a layer): the part — an accepted reason
     (docs/TESTING.md → Saying why something is uncovered) — the specifics: what was looked at on
     the stand, the blind spot, the `it` that covers it. Or "nothing". -->

Mutants: <!-- npm run test:mutants at the commit you mark ready: the count, then each survivor —
     test added | an accepted reason | equivalent, and why. Or "nothing to mutate". -->

Baselines: <!-- each changed or new PNG — what changed and why — diff looked at | re-rendered with
     --update-snapshots=all | new, opened. Or "none". -->

## Docs

<!-- What changed in docs/, CLAUDE.md, README.md or CHANGELOG.md, or "none". Search them for what
     the diff moved or renamed: which test owns a statement, what a sheet or a toast does. -->

## Why tests missed it

<!-- fix/ PRs and fixes of a flaky test; delete the section otherwise. docs/TESTING.md → When we find a bug. -->

Class: `test-gap:<uncovered | wrong-layer | implementation | fake-drift | environment | silent-test | flaky>`, also the label on the issue.

What changes so this class is caught:
