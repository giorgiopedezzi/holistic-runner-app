# Migration notes

This restructuring intentionally changes **where** instructions load, not the product behavior they describe.

## Files

- `CLAUDE.md` — global invariants only; intended to remain under ~200 lines.
- `.claude/rules/backend.md` — backend-only invariants.
- `.claude/rules/frontend.md` — frontend stack/React/styling/UI behavior.
- `.claude/rules/frontend-i18n.md` — i18n invariants, separated so CSS-only work does not pay for i18n detail.
- `.claude/rules/fit-parser.md` — FIT anti-regression field/clock rules.
- `.claude/rules/api-contract.md` — router/OpenAPI synchronization.
- `/implement-story` — existing authority for Story execution, effort handling, Jira writes, issue links, checklist edits, and review workflow. **No `docs/agent-workflow.md` is needed.**

## Intentionally removed from always-loaded context

- `Known issues / open tasks`: this contradicted the existing “status does not live here” rule. Keep live state in Jira or `sessions/*.md`.
- historical rationale and incident narration where the invariant can stand on its own.
- long Jira option/mechanics tables and effort implementation detail; these belong in the existing `/implement-story` skill when they are needed for Story work.

## Before replacing the existing file

Diff this package against the live repo because the original `CLAUDE.md` itself requires file/script claims to be verified before preserving them. In particular, confirm:

- current source tree and package scripts;
- whether `frontend-standards` has since been created;
- whether Jira field option IDs/labels have changed;
- that `/implement-story` contains every Story/Jira/effort invariant removed from the old `CLAUDE.md`. If anything is missing, merge it into the skill rather than creating `docs/agent-workflow.md`.

## Final authority split

- `CLAUDE.md` = global guardrails that must be known in every session.
- `.claude/rules/*.md` = path-scoped guardrails that matter only for matching code.
- `docs/*.md` = descriptive system knowledge read on demand.
- `/implement-story` = procedural Story/Jira/effort authority loaded when executing Story work.

This keeps a single authority per concern and avoids duplicating the Story workflow in both `docs/` and the skill.
