---
name: second-review
description: The second, independent review of the changes to existing checks that the checks guard marked in a pull request — rewritten or removed assertions, tests gone or renamed, a changed threshold, lint rule, CI step or type-check config. Use as `/second-review <PR number>` in a fresh session, after the first review's "ready to merge" and before the owner is asked to approve the merge; also when asked for "the second review" or "второе ревью" of a PR.
---

# Second review

The checks guard marks, in its comment on a PR, the changes to existing checks that a script can't
judge: the list "For a second review". This review answers one question for each mark: **does the
check still catch what it caught before the change?** What its record closes and what blocks a PR
is in `docs/QUALITY.md` → What a marked PR needs; this file is the procedure. The comment on the PR
is in English, like everything on GitHub; a summary in the chat follows the conversation's
language.

## Who and when

- A fresh session that the coordinator starts: not the PR's author, not its first reviewer.
- After the first review's "ready to merge" at the PR's current head, and before the owner is asked
  to approve the merge. Only when the guard's comment has a "For a second review" list.

## 1. Find the list and its code

- Make sure the `guard` job has finished on the PR's current head: the guard's comment is edited
  on every push, and a code from a stale one won't match. `gh api repos/{owner}/{repo}/pulls/<n>`
  gives `head.sha`; the comment's first line names the commit it was written at.
- Read the guard's comment: `gh api repos/{owner}/{repo}/issues/<n>/comments`, the one by
  `github-actions[bot]` that starts with `<!-- checks-guard -->`. Take the marks under "For a
  second review" and the two record lines printed under them, with the list's code. A fork's PR
  gets no such comment, since the job's token can't write there: take the same report from the
  summary of the `Guard` run's `guard` job (`gh run view <run id>`).

## 2. Read each mark's two sides, and nothing of the author's account

- For each mark, read the marked file on both sides: the commit the branch left `main` at
  (`git merge-base origin/main <head>`) and the head. `git diff <merge-base> <head> -- <file>`
  shows what changed; read around the marked line, and the code under test where the mark is a
  test.
- Don't read the PR's description, its Tests section or the first review's rounds until your
  record is posted: the verdict has to be your own.
- You may read the issue the PR closes, the task: the branch's code shows that a behavior is gone,
  not that it was meant to go.

## 3. Answer for each mark

- **An assertion rewritten or removed.** The new one is no weaker than the old, or the behavior the
  old one checked is removed on purpose, which the task confirms, not the code. Where the task
  doesn't ask for that behavior to go, or there is no issue, the mark is a weakening with "the
  intent isn't confirmed": the owner, who knows what was asked for, decides.
- **A test gone or renamed.** Where what it claimed is checked now: name the test.
- **Any other mark** (a threshold or an exclusion list, a lint rule's options, a CI step, an npm
  script, a condition on a step, a `tsconfig`). After the change the check catches no less than
  before.

A mark you can't decide is a weakening.

## 4. Post the record

One comment on the PR. Its first line is the record, copied from the guard's comment with the
code: `sound` when no mark weakens a check, `weakening` when at least one does or you couldn't
decide. Then a line per mark: the file and line, the verdict and why.

```markdown
**Second review 1a2b3c4d: sound**

- `src/torrents/sort.test.ts:165`: sound. The assertion now expects the direction the order keeps
  since this change; `sort.ts`'s `knownOrder` returns it, and the old value is covered by …
```

## 5. After posting

- Re-run the guard's job, which doesn't react to a new comment by itself:
  `gh run rerun <run id> --failed` for the `Guard` run of the PR's head
  (`gh run list --workflow guard.yml --branch <head.ref>`).
- End with a report to the coordinator: the link to the record and the verdict. A `weakening` then
  needs a fix by the author, after which the list has another code and a second review again, or
  the owner's approval of the same code.
- Don't push to the PR's branch and don't merge it.
