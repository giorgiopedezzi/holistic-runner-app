# Ready-to-Develop Jira gate overlay

Merge this ZIP at the repository root.

This is cumulative over the latest Story Git lifecycle/ADF workflow.

## Fix

A new Story can start **only** from Jira `Ready to Develop`.

- Backlog → STOP
- Refinement → STOP
- Ready to Develop → may start after Agent/Model/effort gates
- In Progress → resume only when explicitly continuing the same Story and its branch already exists
- In Review → STOP
- Done → STOP

The agent must never transition a Story into Ready to Develop.

## Files

- `AGENTS.md`
- `.agents/workflows/story-jira-gate.md`
- `.agents/workflows/story-git-lifecycle.md`
- `.agents/skills/implement-story/SKILL.md`

Because Claude imports `AGENTS.md`, this is a shared invariant for Claude Code and Codex. Codex also has the rule explicitly in `$implement-story`.

## New Story order

`read Jira → require Ready to Develop → Agent/Model/effort gate → Story branch → In Progress → edit`

This restores `Ready to Develop` as the actual human Gate 1 rather than treating it as just another Jira status.
