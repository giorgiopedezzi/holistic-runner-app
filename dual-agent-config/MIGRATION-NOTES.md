# Migration notes — Claude Code + Codex

## What changes

1. Root `AGENTS.md` becomes the global source of truth.
2. Root `CLAUDE.md` becomes a thin adapter containing `@AGENTS.md`.
3. Existing `.claude/rules/*.md` remain the single source of truth for path-specific invariants.
4. Codex gets two repo skills:
   - `.agents/skills/implement-story/SKILL.md`
   - `.agents/skills/generate-user-stories/SKILL.md`
5. Codex gets project-local `.codex/config.toml` with safe workspace defaults and Atlassian Rovo MCP.
6. Existing `docs/*.md` remain unchanged.
7. `docs/agent-workflow.md` is not used.

## Why no nested AGENTS.md files

Codex builds its AGENTS instruction chain when a run/session starts, from the repository root down to the **current working directory**. If Codex is launched from the repo root, putting `AGENTS.md` under `garmin-stats/` or `garmin-dashboard/` would not give dynamic path-trigger behavior when Codex later reads those files.

Therefore path-specific rules stay centralized in `.claude/rules/`:
- Claude applies them natively via `paths:`.
- Codex reads the applicable same files before editing.

This avoids two diverging copies of the same invariants.

## New dual-agent gate

For new Stories, `Agent` is treated as mandatory alongside Model and Planned effort:
- `Claude Code`
- `Codex`

The active harness must match Jira. Mismatch = STOP.

This is intentionally human routing, not an automated router.

## Jira Model options

Add:
- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`

Keep:
- `claude-sonnet-5`
- `claude-opus-5`

## Effort compatibility

Keep the Jira ladder `low / medium / high / xhigh / max`.

Important: current Codex local config documentation exposes reasoning effort through `xhigh`, even though the GPT-5.6 API family supports `max`. The Codex skill therefore refuses a `max` Story when the running client cannot explicitly select it. No silent downgrade.

## One policy addition to review

`AGENTS.md` sets `Agent` as mandatory for Stories entering Ready to Develop from `2026-08-26`.

If you prefer a different policy epoch, change that date in:
- `AGENTS.md`
- `.agents/skills/implement-story/SKILL.md`

Do not backfill older Stories.
