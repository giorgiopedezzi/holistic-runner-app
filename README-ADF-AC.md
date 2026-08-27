# Jira ADF Acceptance Criteria overlay

Merge this ZIP at the repository root.

It makes Jira Acceptance Criteria a shared, explicit ADF invariant for both Claude Code and Codex.

## Files

- `AGENTS.md` — adds the global invariant and routing entry.
- `.agents/workflows/jira-acceptance-criteria.md` — single source of truth for creating and completing Jira AC action items.
- `.agents/workflows/refine-prompt.md` — generated Stories must create AC as ADF `taskList` / `taskItem`, initially `TODO`.
- `.agents/skills/implement-story/SKILL.md` — Codex verifies each AC individually and marks only proven ADF task items `DONE`.

Because Claude Code imports `AGENTS.md`, it receives the same shared invariant. Its existing `/implement-story` workflow must obey the routed shared ADF rule even if its adapter remains unchanged.

## Key rule

Never convert Jira action items to markdown checkboxes.

Creation:
`Acceptance Criteria → taskList → taskItem(TODO)`

Implementation:
`implement → verify each AC → taskItem DONE only if proven → Actual effort → In Review`

If Jira tooling cannot safely preserve ADF, leave the checklist unchanged and report the limitation instead of degrading the structure.
