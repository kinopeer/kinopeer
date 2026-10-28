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

Not covered: <!-- each part of the diff without a test: the part — an accepted reason
     (docs/TESTING.md → Saying why something is uncovered) — the specifics: what was looked at on
     the stand, the blind spot, the `it` that covers it. Or "nothing". -->

Baselines: <!-- each changed or new PNG — what changed and why — diff looked at | re-rendered with
     --update-snapshots=all | new, opened. Or "none". -->

## Docs

<!-- What changed in docs/, CLAUDE.md, README.md or CHANGELOG.md, or "none". -->

## Why tests missed it

<!-- fix/ PRs only; delete the section otherwise. docs/TESTING.md → When we find a bug. -->

Class: `test-gap:<uncovered | wrong-layer | implementation | fake-drift | environment | silent-test>`, also the label on the issue.

What changes so this class is caught:
