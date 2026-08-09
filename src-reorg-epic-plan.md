# Epic plan — reorganize `garmin-stats/src/`

> Draft for review. Nothing created in Jira yet. Once approved → create Epic + R1–R5, then green light to implement (R1 first).
> Informed by the LLM Council verdict (2026-08-09): Executor's phased plan + the peer-review blind-spots (docs staleness, package.json / `.ps1` string paths, synonym-folder confusion), and dropping the over-scope (`Source` plugin interface).

---

## Epic

**Summary:** `Enabler: reorganize garmin-stats/src (domain / integrations / jobs) + naming cleanup`

**Fields:** Contributor Type = **Human** · Category = **Enabler/infrastructure** · Status = Backlog

**Description:**
Establish a clean, idiomatic `src/` layout as the solid base **before** adding a test suite and doing the client-alignment work. Groups the ~16 files still loose at `src/` root into concern-based folders and fixes the `withings-auth` / `auth-withings` word-swap. Backend only, behavior-preserving.

- **Stays at `src/` root:** `server.ts` (entry), `config.ts`, `db.ts` (foundational, imported everywhere).
- **Unchanged layered dirs:** `http/`, `controllers/`, `services/`, `repositories/`, `@types/`.
- **Out of scope:** the `Source`/plugin interface (council: premature for a solo app); the frontend/client changes (a later slice, after tests).
- **Branching:** stacks **linearly** on the backend refactor tip (`fix/hra-50-plural-paths`) — not a parallel branch — so the reorg is the last commit in the stack and there is no rebase-conflict tax. (Addresses the council's #1 concern by construction.)

**Target structure:**
```
src/
  server.ts                 # entry (root)
  config.ts   db.ts         # foundational infra (root)
  http/                     # (unchanged) respond, request, router, context, oauth, stream-sync, withings-callback
  controllers/              # (unchanged) activities, body, trends, settings, sync, integrations, docs
  services/                 # (unchanged) activities, body, classification, sync, device*  (*was integrations.service — see decision 2)
  repositories/             # (unchanged) activities, body, settings
  domain/                   # pure, framework-agnostic (no I/O)
    fit-parser.ts   fit-file-parser-validate.ts   workout-metrics.ts   stats-classifier.ts
  integrations/             # external-service clients
    withings.ts   strava.ts   ollama.ts
  jobs/                     # runnable batch / CLI
    sync-garmin.ts  sync-strava.ts  sync-withings.ts  reprocess-fit-archive.ts  withings-login.ts
  scripts/                  # native PowerShell helpers  (name TBD — see decision 1)
    activities-file-extractor.ps1   check-garmin-device.ps1
  @types/                   # (unchanged)
```

---

## User Stories

All stories: Contributor Type = **Hybrid** · Agent = **Claude Code** · Model = **claude-sonnet-5** · Category = **Technical Improvement** · Status = Backlog.
Each is its own commit/PR, snapshot-verified, moved to **In Review** individually (I stop there; you review → Done).

### R1 — Cruft cleanup + capture baseline
- **Cost Tier:** Low · **Risk:** trivial
- **Do:** delete `src/fit-parser.txt` (stale 242-line copy of `fit-parser.ts`); delete the stray `src/garmin.db` (accidental — the real DB is `garmin-stats/garmin.db`; git-ignored). Capture a fresh golden-master baseline (`tests/snapshot.sh`) as the reference for every later move.
- **Acceptance:** files gone; baseline captured; `git status` clean; typecheck clean.
- **Why first:** pure win, unrelated to the moves, and you can't verify a move without "known good" recorded first (Executor).

### R2 — Extract `domain/` (pure logic)
- **Cost Tier:** Low · **Risk:** low
- **Move → `src/domain/`:** `fit-parser.ts`, `fit-file-parser-validate.ts`, `workout-metrics.ts`, `stats-classifier.ts`.
- **Do:** `git mv` (preserve history); update the explicit `.ts` relative imports via IDE move-refactor (not by hand).
- **Acceptance:** backend `npm run typecheck` clean; **all golden-master snapshots byte-identical**; no remaining imports of the old paths.

### R3 — Extract `integrations/` + disambiguate client names
- **Cost Tier:** Low · **Risk:** low
- **Move + rename → `src/integrations/`:** `withings-auth.ts` → `withings.ts`; `strava-auth.ts` → `strava.ts`; `ollama-service.ts` → `ollama.ts`.
- **Why:** kills the `withings-auth` / `auth-withings` word-swap — module = noun (`integrations/withings.ts`, the client), command = verb (`jobs/withings-login.ts`, done in R4).
- **Acceptance:** typecheck clean; snapshots byte-identical; imports updated across `http/`, `controllers/`, `services/`, `jobs/`.

### R4 — Extract `jobs/` + `scripts/` + rewire spawn / data / package paths  ⚠ the risky one
- **Cost Tier:** Medium · **Risk:** medium (the silent-path hazard lives here)
- **Move → `src/jobs/`:** `sync-garmin.ts`, `sync-strava.ts`, `sync-withings.ts`, `reprocess-fit-archive.ts`, and `auth-withings.ts` → `withings-login.ts`.
- **Move → `src/scripts/`** (name TBD): `activities-file-extractor.ps1`, `check-garmin-device.ps1`.
- **Rewire (each is a distinct break):**
  - **`package.json`** script paths → `src/jobs/…`; rename `auth:withings` → `withings:login`. Grep `start.sh` / docs for `auth:withings`.
  - **server spawn wiring** — `scriptsDir` / scriptName in `services/sync.service.ts`, `http/stream-sync.ts`, and the device service.
  - **`.ps1` string paths** — `sync-garmin.ts`'s spawn of `activities-file-extractor.ps1`, and the device-check spawn of `check-garmin-device.ps1`.
  - **`__dirname`-relative data paths** inside the moved jobs — `../fit-archive` → `../../fit-archive`, `../strava-archive`, `../config.json`, etc. **← the single most likely silent breakage: a wrong path doesn't crash; sync writes to a new wrong dir while dedup reads the old DB → silent divergence.**
- **Acceptance (non-negotiable):** typecheck clean; snapshots byte-identical; **a real Garmin device check (`/api/garmin/status`) + one live sync run** — spawn/data paths are NOT snapshot-covered, so this must be exercised for real. Grep confirms no `__dirname` path still resolves to the old depth.

### R5 — Update the docs' layout map
- **Cost Tier:** Low · **Risk:** trivial
- **Do:** rewrite `CLAUDE.md`'s repository-layout section and `PROJECT-OVERVIEW.md` to the new structure — the repo's own map must not go stale (council blind-spot; matters for the governance/portfolio record).
- **Acceptance:** every path in the docs matches the tree; no stale references to moved/renamed files.

---

## Sequencing
`R1 → R2 → R3` (low-risk, each mergeable independently) → `R4` (risky, live-verified) → `R5` (docs = "done").

---

## Decisions to confirm (before creating in Jira)
1. **`scripts/` folder name** — council flagged `jobs`/`scripts` as confusing synonyms. Recommend **`powershell/`** (both files are `.ps1`). Alternatives: `bin/`, or keep `scripts/`.
2. **`integrations/` vs existing `services/integrations.service.ts`** — that service now only does the Garmin device check. Recommend renaming it **`services/device.service.ts`** so "integrations" isn't in two layers.
3. **`config.ts` / `db.ts` stay at `src/` root** (council-endorsed; high churn to move, low benefit). Confirm — or a shallow `core/`?
4. **Epic category** = Enabler/infrastructure (vs Technical Improvement)?

---

## Verification tooling (already in place)
- `tests/snapshot.sh` — golden-master harness (23 deterministic read endpoints, bodies + HTTP status codes). Backend/HTTP coverage.
- **Gap (deliberate):** spawn/device/data-file paths are NOT snapshot-covered → R4 requires a real device check + live sync. (This gap is itself a candidate for the future test-suite epic.)
