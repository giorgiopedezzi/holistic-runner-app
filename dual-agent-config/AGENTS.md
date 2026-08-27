# Garmin Stats — shared agent context

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

These constraints apply to every Story session and every subagent.

1. **A Story must have `Agent` (`customfield_10115`), `Model` (`customfield_10116`), and `Planned thinking effort` (`customfield_10117`) filled before implementation starts.** If a required field is empty, STOP and ask the human to set it.
2. **The launched agent must match Jira `Agent`.** Supported values in this repo are `Claude Code` and `Codex`. A mismatch is a STOP.
3. **The launched model must match Jira `Model`.** Never rewrite Jira to match the running session.
4. **Never write human decision fields:** `Contributor Type` (`10114`), `Agent` (`10115`), `Model` (`10116`), `Planned thinking effort` (`10117`), `Review Outcome` (`10118`). Read and obey them; never modify them.
5. **Exception:** write `Actual thinking effort` (`10152`) at In Review using the active `implement-story` workflow and objective evidence, never by impression.
6. **Model and effort are launch-bound.** STOP on a known mismatch. Never change model or effort mid-slice.
7. **First output line for Story work:** state `Agent`, `Model`, and `Planned thinking effort`, plus what that effort commits you to.
8. **Stop at In Review.** Transition the Story to In Review, post the review comment, then STOP. Never move it to Done.
9. **Implement only the approved Story slice.** Do not re-scope, re-plan, or improve adjacent code. Record out-of-scope findings as candidates in the In Review comment.
10. **API contract and client-type changes belong to Epic HRA-36**, not opportunistically to another Story.
11. **One Story per invocation/session.** Never chain Stories in one run.

**Policy epochs**
- `Model` and `Planned thinking effort`: mandatory for Stories entering Ready to Develop from **2026-08-12 ~17:30 CEST** onward. Never backfill older issues.
- `Agent`: mandatory for Stories entering Ready to Develop from **2026-08-26** onward. Never backfill older issues merely to satisfy this rule.

### Story workflow authority

Use the active harness's `implement-story` workflow:
- Claude Code: `/implement-story`
- Codex: `$implement-story` (repo skill under `.agents/skills/implement-story/`)

The workflow is the authority for Jira mechanics, effort classification, ADF checklist safety, transitions, and review comments.

---

## Editing and shell safety

- **Never mutate tracked source files with raw line-number shell edits** (`sed -i 'X,Yd'`, `awk NR...`, equivalents). Use a content-aware patch/edit mechanism so drift fails loudly.
- Raw shell mutation is only for cases with no content-aware mechanism available.
- **Never run `cd <dir> && git <cmd>`.** Use `git -C <dir> <cmd>`.
- **Never kill a background job via `%N` shell job-control syntax.** Resolve the exact PID first, then terminate that PID (`taskkill //PID <pid> //F` on this Windows repo).

---

## Repository map

```text
holistic-runner-app/
├── AGENTS.md                  # shared global instructions (source of truth)
├── CLAUDE.md                  # thin Claude adapter importing AGENTS.md
├── .claude/rules/             # shared path-scoped invariants; native to Claude
├── .agents/skills/            # Codex repo skills
├── .codex/config.toml         # Codex project configuration
├── docs/                      # descriptive/reference context, read on demand
├── start.sh
├── garmin-stats/              # Node 24 backend — no build step
│   └── src/
│       ├── config.ts / db.ts / server.ts
│       ├── http/ → controllers/ → services/ → repositories/
│       ├── domain/
│       ├── integrations/
│       ├── jobs/
│       └── powershell/
└── garmin-dashboard/          # Vite 8 + React 19 + TypeScript 6
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

## Shared path-rule routing

`.claude/rules/` is the single source of truth for project-specific preventive rules.

- **Claude Code:** path-scoped rules load natively when matching files are read.
- **Codex:** before editing, read every applicable rule from the table below. Do not duplicate these rules into `AGENTS.md`.

| Working on / matching area | Read |
|---|---|
| `garmin-stats/src/**/*.ts`, backend package/tsconfig | `.claude/rules/backend.md` |
| `garmin-dashboard/src/**/*.{ts,tsx,css}`, frontend config | `.claude/rules/frontend.md` |
| frontend TS/TSX or `garmin-stats/locales/*.json` | `.claude/rules/frontend-i18n.md` |
| `fit-parser.ts` or FIT parser tests | `.claude/rules/fit-parser.md` |
| `garmin-stats/src/http/router.ts` or `garmin-stats/openapi.json` | `.claude/rules/api-contract.md` |

When multiple rows match, load all matching rules.

---

## Read-on-demand routing

Descriptive or task-specific detail lives outside global instructions and must be read before working in that area.

| Working on… | Read / use |
|---|---|
| Story implementation / Jira workflow | active `implement-story` workflow |
| Story decomposition / refinement | Codex `$generate-user-stories` or the equivalent human-reviewed Claude workflow |
| DB schema, columns, soft delete/trash/purge | `docs/schema.md` |
| HTTP endpoints, bodies, status codes, CORS | `docs/api.md` |
| Garmin MTP, Withings OAuth, Strava, FIT cross-validation | `docs/ingestion.md` |
| React, charts, theme, units, CSS tokens | `docs/frontend.md` |
| Workout classification | `docs/classifier.md` |
| RunPlan DSL v1 | `docs/runplan-dsl.md` |

---

## Authority and precedence

Project rules and approved Story acceptance criteria are authoritative.

When specialist skills are available in the active harness, use them for their concern; when they are not available, do not invent a substitute skill—follow repository docs/rules and existing code conventions.

Existing Claude specialist authorities include:
- REST / HTTP contract: `rest-api-standards`
- Node/JS code style: `nodejs-code-style`
- visual/UI design: `frontend-design`
- React/Next performance: `vercel-react-best-practices`
- React component architecture: `vercel-composition-patterns`
- charts/data-viz: `dataviz`

Precedence when concerns overlap: **approved behavior / correctness / contract > code structure > visual taste**.

---

## Maintenance

Keep this file small enough to deserve unconditional loading.

1. **Global-only:** keep here only rules needed in virtually every session.
2. **Path-specific prevention:** keep in `.claude/rules/`; Codex consumes those same files through the routing table.
3. **Task-specific procedure:** keep in a skill/workflow; descriptive reference belongs in `docs/`.
4. **Prevent vs describe:** prevention stays in instructions; description belongs in `docs/`.
5. **Reachability:** anything moved out must remain reachable from this routing table, a path rule, or a named workflow.
6. **Delete settled history.** Git/Jira are the history; do not preserve obsolete status notes here.
7. **Status does not live here.** No current/in-flight/awaiting-review notes.
8. **Verify before keeping:** any claim naming a file, hook, flag, script, or npm command must be checked against the live repo before preserving it.
9. **Repository layout maintenance:** after adding/removing/moving source files, update the map in the same turn if its structural summary changed.

Target: keep `AGENTS.md` **under ~200 lines**.
