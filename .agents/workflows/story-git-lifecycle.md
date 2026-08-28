# Git lifecycle for Story implementation

This workflow applies to every implementation Story executed by Claude Code or Codex.

The Git branch and commit are part of completing the Story, not optional housekeeping.

Repository root:

`C:/Projects/PERSONAL/holistic-runner-app`

Always use `git -C <repo-root> ...`. Never use `cd ... && git ...`.

## 1. Before editing: establish a clean Story branch

After the Jira status Gate 1 and the Agent / Model / Planned-effort gates pass, but **before any source edit**:

1. Inspect:
   - `git -C C:/Projects/PERSONAL/holistic-runner-app status --short`
   - `git -C C:/Projects/PERSONAL/holistic-runner-app branch --show-current`
2. If the working tree contains changes that cannot be confidently attributed to the same Story:
   - do not stash them;
   - do not discard them;
   - do not absorb them into this Story;
   - STOP and ask the human.
3. If already on the correct Story branch, continue on it.
4. Otherwise create a Story branch from the **currently checked-out clean base branch**.

Branch name:

`feature/<JIRA-KEY>-<story-summary-slug>`

Example:

`feature/HRA-172-export-resolved-workout-to-garmin-fit`

Slug rules:
- derive from the Jira Story summary;
- lowercase words after the Jira key;
- kebab-case;
- ASCII letters/numbers/hyphens only;
- keep it short and recognizable; do not reproduce the whole summary.

Create it with:

`git -C C:/Projects/PERSONAL/holistic-runner-app switch -c <branch-name>`

Do not fetch, pull, rebase, merge, or change the base branch automatically.

For a new Story, Jira must still be `Ready to Develop`; transition it to `In Progress` after the Story branch exists. For an explicit resume, Jira may already be `In Progress` only under `.agents/workflows/story-jira-gate.md`.

## 2. During implementation

All in-scope Story changes belong on that Story branch.

Do not commit intermediate speculative attempts unless the Story explicitly requires multiple commits.

Do not use `git add .` or `git add -A`.

When inspecting work, prefer:
- `git ... status --short`
- `git ... diff`
- `git ... diff --cached`

Never discard unrelated changes automatically.

## 3. After verification: create the Story commit

A Story may move to **In Review only after its verified implementation is committed**.

After all required verification has passed:

1. Inspect the final working tree and diff.
2. Confirm every changed/untracked file intended for commit belongs to the approved Story scope.
3. Stage **only the explicit Story files**, using:
   - `git -C <repo-root> add -- <file1> <file2> ...`
4. Inspect:
   - `git -C <repo-root> diff --cached`
5. If the staged diff contains anything outside the Story scope, fix the staging before committing.
6. Commit with:

`git -C <repo-root> commit -m "<JIRA-KEY>: <Story summary>"`

Example:

`git -C C:/Projects/PERSONAL/holistic-runner-app commit -m "HRA-172: Export resolved workout to Garmin FIT"`

7. Record:
   - branch name;
   - commit hash (`git ... rev-parse HEAD`).
8. Re-check `git status --short`.

The expected state is clean after the commit. If relevant Story changes remain uncommitted, do not move Jira to In Review.

Ignored/generated runtime files do not count as Story changes.

## 4. Jira handoff order

The required end-of-Story order is:

`implement → verify → update verified AC taskItems → stage explicit files → inspect staged diff → commit → record commit hash → Actual thinking effort → In Review → review comment → STOP`

The In Review comment must include:

- `Branch: <branch-name>`
- `Commit: <full-or-short-hash>`
- files changed;
- verification evidence;
- Acceptance Criteria evidence;
- Actual thinking effort evidence;
- residual risks / out-of-scope candidates.

## 5. What is NOT authorized

Story implementation does **not** authorize:

- `git push`;
- `git pull`;
- `git fetch`;
- `git merge`;
- `git rebase`;
- `git reset`;
- `git clean`;
- force operations;
- history rewriting;
- deleting branches;
- discarding pre-existing human changes.

Those require a separate explicit human request.

## Core invariant

A Story reaching Jira **In Review** means there is a reviewable Git commit on a dedicated Story branch.

No branch + no commit = the Story is not ready for In Review.
