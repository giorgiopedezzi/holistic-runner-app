# Holistic Runner App (HRA)

A privacy-first, **local-only** endurance + body-composition dashboard. It pulls raw training
data straight off a Garmin watch and a Withings scale, keeps everything in a single local
database, and turns it into one dashboard that shows training load and body composition
side by side — instead of two separate apps that never talk to each other.

## What it does

- **Ingests training data from two independent sources** — a Garmin Forerunner 965 (via a
  from-scratch binary `.FIT` file parser, no vendor SDK) and Strava (via OAuth API, with
  cross-source duplicate detection so a Garmin activity that also lands on Strava isn't
  double-counted).
- **Ingests body composition data** from a Withings scale via OAuth API: weight, fat %, fat
  mass, muscle mass, hydration, bone mass, BMI, resting heart rate.
- **Surfaces both together** in one dashboard: per-sport distance/pace/HR trends, a full
  per-activity chart (pace, HR, altitude, cadence, power, with automatic pause detection),
  body-composition trends, and — the "holistic" piece — a direct **weekly running distance
  vs. average body weight correlation chart**, so training volume and weight trends are
  visible on the same timeline rather than reconstructed by hand from two separate apps.
- **Classifies running workouts** (Recovery Run, Long Session, Repeats/Intervals, Progressive
  Run, Fartlek, Tapasciata) either via a local LLM (Ollama) or a fully deterministic
  statistics-based classifier (pace variance, splits, pause pattern) — both run entirely
  on-device, with a human review/correction workflow before either result counts as ground
  truth.

## The privacy-first, local-only design

Every byte of training and body data lives in a single SQLite file on the user's own machine.
There is no backend service, no cloud sync, and no third-party analytics anywhere in the stack.
The only network calls the app ever makes are the two data sources' own OAuth flows (Withings,
Strava) and, optionally, a locally-running Ollama instance for AI workout classification — which
itself never leaves the machine either. Concretely:

- Node's built-in `node:sqlite` — no hosted database, no ORM talking to a remote service.
- OAuth tokens for Withings/Strava are stored in that same local SQLite file, refreshed
  automatically, never proxied through a third party.
- The AI classifier calls `localhost:11434` (Ollama) — if Ollama isn't running, the app falls
  back to the deterministic statistical classifier rather than reaching for a cloud API.
- Deleting is a genuine local operation: activities/measurements move to a local trash first
  (restorable), and only a second explicit "purge" step actually reclaims space — there's no
  server-side copy anywhere else to worry about.

## Module map

### Backend — `garmin-stats/` (Node 24, zero build step, near-zero runtime dependencies)

| Area | Files | What it does |
|---|---|---|
| FIT parsing | `domain/fit-parser.ts` | From-scratch binary decoder for Garmin's `.FIT` format — session summaries, per-second track points, developer-field extensions. Cross-validated on import against a second, independent third-party parser (`domain/fit-file-parser-validate.ts`) purely as a sanity check; never the source of truth. |
| Garmin sync | `jobs/sync-garmin.ts`, `powershell/activities-file-extractor.ps1`, `powershell/check-garmin-device.ps1` | Shells out to a PowerShell/MTP bridge to copy new `.FIT` files off the watch, then parses and imports them. Raw files are archived permanently, never deleted. |
| Withings | `integrations/withings.ts`, `jobs/withings-login.ts`, `jobs/sync-withings.ts` | OAuth2 flow (in-app popup or standalone CLI) + incremental measurement sync. |
| Strava | `integrations/strava.ts`, `jobs/sync-strava.ts` | OAuth2 flow (rotating refresh tokens) + activity/stream sync, with cross-source duplicate detection against existing Garmin activities. |
| AI classifier | `domain/workout-metrics.ts`, `integrations/ollama.ts`, `domain/stats-classifier.ts` | Reduces a run's raw track points into a compact summary, then classifies it via either a local LLM or deterministic rules — two independently-stored results per activity, so both can be run and compared before either is confirmed as ground truth. |
| Storage & API | `db.ts`, `server.ts`, `config.ts` | SQLite schema (with soft-delete/trash/purge for both activities and body measurements) and a local REST API on port 3001 covering activities, body measurements, sync triggers, settings, and the classifier workflow. |

### Frontend — `garmin-dashboard/` (Vite + React 19 + TypeScript, strict)

Five tabs, all reading from the local API, no client-side data fetching outside an explicit
"Load data" action:

| Tab | What it shows |
|---|---|
| **Overview & Trends** | Per-sport distance/pace/HR trend charts (single-activity, weekly, or monthly grouping), with reference bands for each sport's avg/min/max. |
| **Activities** | Paginated activity list; each activity expands into a full multi-metric chart (speed/pace, HR, altitude, cadence, power) with outlier filtering, pause detection, and the AI/statistical workout classifier. |
| **Body** | Withings body-composition trends (weight, fat mass, muscle mass, hydration, bone mass, BMI, resting HR) plus the training-vs-weight correlation chart. |
| **Data & Sync** | Triggers device-status-gated syncs for all three sources, bulk workout classification, and the delete/trash/restore/purge workflow. |
| **Settings** | Outlier-detection thresholds, trend-grouping thresholds, theme/background/measurement-unit preferences — all persisted server-side, not in browser storage. |

## Stack choice: why React over Angular

Angular was the initial preference, but the project deliberately switched to React specifically
because it has **substantially better training-data coverage for AI coding assistants** —
this app was built almost entirely through iterative AI prompting (see below), and React's
larger footprint in public code/documentation translates directly into faster, more reliable
AI-generated code with fewer hallucinated APIs. The rest of the stack follows the same
"boring and well-documented" bias: Vite over a custom bundler, Recharts over a lower-level
charting library, plain CSS variables over a CSS framework.

## Built via iterative AI prompting

The codebase was written as **pure-AI code**: a human directs (specifies the feature, reviews
the result, calls out bugs or UX issues), and an AI coding assistant (Claude Code) implements
it end to end — parsing binary file formats, designing the SQLite schema, wiring OAuth flows,
building the React components and charts. Every feature in this repo went through that
human-directs / AI-implements / human-verifies loop rather than being hand-written.

## How the AI's context is governed

The assistant reads a context file (`CLAUDE.md`) at the start of every session, before anything is
asked of it — so that file's size is a permanent tax on every piece of work in this repo. It
carried a maintenance rule telling each session to record what had changed, and no rule about what
to take out. It reached **15,390 words**, of which roughly 7% were rules the assistant must always
follow; the rest was reference material that only mattered when working in one specific area.
Nothing was written carelessly — every addition was correct when it was made. The file got worse
one good decision at a time.

It was split in August 2026. `CLAUDE.md` now holds only what **prevents a mistake** — the agent
code of conduct, the skill manifest, the repository map, the stack constraints, and the FIT
parser's do-not-regress invariants. Everything that merely **describes** the system moved into
`docs/`, reachable from a routing table in `CLAUDE.md` itself. Always-on context went from 15,390
to **3,437 words, a 78% reduction**, with the material preserved and relocated rather than
summarised away.

The maintenance rule now has both halves. A section stays resident only if it prevents a mistake
rather than describes the system; anything moved must appear in the routing table, since a file
nothing points at is invisible in practice; and settled history is deleted rather than filed,
because that is what the git log is for. The one deliberate exception is the FIT parser section —
expensive, and resident anyway, because every line in it is a binary-format field number that was
already got wrong once. Function decides what stays, not size.

## Current limitations & gaps

- **Test coverage is thin, not absent.** Both projects have suites — `node --test` for the backend
  (`npm test` in `garmin-stats/`), Vitest for the frontend — plus an HTTP golden-master snapshot
  script (`tests/snapshot.sh`). What exists is unit coverage over the pure domain logic (FIT
  parser, workout metrics, statistical classifier) and a handful of smoke/regression tests, not
  broad component or end-to-end coverage. A deliberate frontend test baseline is planned work.
- **Strava integration is implemented but not yet exercised with real credentials** — the OAuth
  routes and status checks are verified against a placeholder `client_id`/`client_secret` in
  `config.json`; the actual token exchange and a live sync run are still pending real API
  credentials.
- **The AI workout classifier depends on a locally-running Ollama instance** for one of its two
  methods — the deterministic statistical method has no such dependency, but the LLM path adds
  real (if fully local) infrastructure the user has to keep running.
- **Client-side pagination, not server-side** — the activities list fetches the full range and
  paginates in the browser. Fine at personal-dashboard data volumes; wouldn't scale past that
  without backend changes.
- **Single-user, single-machine only** — no accounts, no multi-device sync, no concept of
  "remote access" by design (this is the direct cost of the privacy-first local-only model).
- **Light themes' chart colors are unvalidated** — accent colors used across charts were
  contrast-checked against the dark theme's surface color only; light themes render but
  haven't had the same pass.
- **No CI/CD pipeline** — builds/typechecks are run locally, not automated on push.
