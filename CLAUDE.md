# Garmin Stats — Claude Code context

## Project

Root: `C:\Projects\PERSONAL\holistic-runner-app\`

Personal health dashboard using data from:
- Garmin Forerunner 965 via MTP/PowerShell bridge
- Strava via OAuth API as an independent activity source with duplicate detection
- Withings scale via OAuth API

Data is stored in local SQLite and visualized in a React dashboard.

Local environment: Windows 11 · Git Bash · Node 24 LTS · WebStorm 2026.2.

---

## Human-gated Story workflow — non-negotiable

These constraints apply to every session and every subagent.

1. **Do not start a Story unless both `Model` (`customfield_10116`) and `Planned thinking effort` (`customfield_10117`) are filled.** If either is empty, STOP and ask the human to set it.
2. **Never write human decision fields:** `Contributor Type` (`10114`), `Agent` (`10115`), `Model` (`10116`), `Planned thinking effort` (`10117`), `Review Outcome` (`10118`). Read and obey them; never modify them.
3. **Exception:** write `Actual thinking effort` (`10152`) at In Review, using the objective criteria defined by `/implement-story`, never by impression.
4. **Model and effort are launch-bound.** Read the Story's model/effort, compare with the launched session, and STOP on a known mismatch. A running session cannot reliably self-read `/effort`; treat the launched effort as a declared precondition. Never change model or effort mid-slice.
5. **First output line for Story work:** state the Story's `Model` and `Planned thinking effort`, and what that effort commits you to.
6. **Stop at In Review.** Transition the Story to In Review, post the review comment, then STOP. Never move it to Done.
7. **Implement only the approved Story slice.** Do not re-scope, re-plan, or improve adjacent code. Record out-of-scope findings as candidates in the In Review comment.
8. **API contract and client-type changes belong to Epic HRA-36**, not opportunistically to another Story.
9. **One Story per invocation.** Never chain Stories in one run.

**Policy epoch:** mandatory decision fields apply to Stories entering Ready to Develop from **2026-08-12 ~17:30 CEST** onward. Never backfill older issues.

For any Story execution, Jira write, effort decision, issue-link edit, or checklist edit, **use `/implement-story`**. It is the authority for the Story/Jira workflow.

---

## Editing and shell safety

- **Never mutate tracked source files with raw line-number shell edits** (`sed -i 'X,Yd'`, `awk NR...`, equivalents). Use the content-aware Edit tool so drift fails loudly.
- Raw Bash mutation is only for cases with no content-aware tool available.
- **Never run `cd <dir> && git <cmd>`.** Use `git -C <dir> <cmd>`.
- **Never kill a background job via `%N` shell job-control syntax.** Resolve the exact PID first, then terminate that PID (`taskkill //PID <pid> //F` on this Windows repo).

---

## Repository map

```text
holistic-runner-app/
├── CLAUDE.md
├── .claude/rules/              # path-scoped invariants
├── docs/                       # descriptive/reference context, read on demand
├── start.sh                    # checks ports 3001 + 5173, starts what's missing
├── garmin-stats/               # Node 24 backend — no build step
│   └── src/
│       ├── config.ts / db.ts / server.ts       # wiring only
│       ├── http/ → controllers/ → services/ → repositories/
│       ├── domain/                              # pure logic, no I/O
│       ├── integrations/                        # external-service clients; module = noun
│       ├── jobs/                                # runnable batch/CLI; command = verb
│       └── powershell/                          # MTP helpers
└── garmin-dashboard/           # Vite 8 + React 19 + TypeScript 6 frontend
    └── src/
        ├── App.tsx
        ├── hooks/useQuery.ts
        ├── domain/
        └── components/
```

The skeleton drifts. For the current source tree use:

```bash
find garmin-stats/src garmin-dashboard/src -type f
```

Naming rule from HRA-52: **module = noun; command = verb**.

---

## Skill authority map

Keep concerns orthogonal; overlapping skill descriptions are a smell.

| Concern | Authority |
|---|---|
| REST / HTTP contract | `rest-api-standards` |
| Node/JS code style | `nodejs-code-style` |
| Visual/UI design | `frontend-design` |
| React/Next performance | `vercel-react-best-practices` |
| React component architecture | `vercel-composition-patterns` |
| Frontend conventions | `frontend-standards` *(planned)* |
| Charts/data-viz | `dataviz` |

Precedence when concerns overlap: **correctness/contract > code structure > visual taste**.

---

## Read-on-demand routing

`CLAUDE.md` holds global mistake-prevention only. Descriptive or task-specific detail lives elsewhere and must be read before working in that area.

| Working on… | Read |
|---|---|
| Story/Jira workflow, effort, Jira field mechanics | `/implement-story` |
| DB schema, columns, soft delete/trash/purge | `docs/schema.md` |
| HTTP endpoints, bodies, status codes, CORS | `docs/api.md` |
| Garmin MTP, Withings OAuth, Strava, FIT cross-validation | `docs/ingestion.md` |
| React, charts, theme, units, CSS tokens | `docs/frontend.md` |
| Workout classification | `docs/classifier.md` |
| RunPlan DSL v1 | `docs/runplan-dsl.md` |

Path-specific preventive rules live in `.claude/rules/` and load when matching files are read.

---

## Maintenance

This file must stay small enough to deserve unconditional loading.

1. **Global-only:** keep here only facts/rules needed in virtually every session.
2. **Path-specific prevention → `.claude/rules/`.** If a rule matters only when certain files are touched, scope it with `paths:`.
3. **Task-specific procedure → a skill; descriptive reference → `docs/`.** Do not keep Jira mechanics, long workflows, or reference tables resident here.
4. **Prevent vs describe:** prevention stays in instructions; description belongs in `docs/`.
5. **Reachability:** anything moved out must be reachable from this routing table, an applicable path rule, or the named authority skill.
6. **Delete settled history.** Git/Jira are the history; do not preserve obsolete status notes here.
7. **Status does not live here.** No current/in-flight/awaiting-review notes.
8. **Verify before keeping:** any claim naming a file, hook, flag, script, or npm command must be checked against the live repo before preserving it.
9. **Repository layout maintenance:** after adding/removing/moving source files, update the map in the same turn if its structural summary changed.

Target: keep this file **under ~200 lines**. Function beats completeness; load detail only where it can affect a decision.
