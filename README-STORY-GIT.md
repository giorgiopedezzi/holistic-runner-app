# Story Git lifecycle overlay

Merge this ZIP at the repository root.

This fixes the missing Git lifecycle in Codex Story implementation while keeping Claude and Codex aligned through a shared workflow.

## What changes

### Shared
- `AGENTS.md`
  - Story branch + commit become mandatory before In Review.
- `.agents/workflows/story-git-lifecycle.md`
  - single source of truth for both Claude Code and Codex.

### Codex
- `.agents/skills/implement-story/SKILL.md`
  - now explicitly creates/reuses the Story branch before editing;
  - commits verified Story changes before Jira In Review;
  - includes branch + commit in the handoff.
- `.codex/rules/story-git.rules`
  - auto-allows only the local Git operations needed by that workflow.

## Branch convention

`feature/<JIRA-KEY>-<story-summary-slug>`

Example:

`feature/HRA-172-export-resolved-workout-to-garmin-fit`

## Commit convention

`<JIRA-KEY>: <Story summary>`

Example:

`HRA-172: Export resolved workout to Garmin FIT`

## End-of-Story order

`implement → verify → AC taskItems → explicit git add → staged diff → commit → Actual effort → In Review → review comment`

## Intentionally NOT authorized

- push
- pull
- fetch
- merge
- rebase
- reset
- clean
- force/history rewrite
- branch deletion

Those remain human-explicit operations.

## Important

Codex project-local rules are loaded only when the repository `.codex/` config layer is trusted, and Codex must be restarted after adding/changing rules.
