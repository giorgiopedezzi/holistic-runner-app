# Garmin Stats — Claude Code context

## Project root
`C:\Projects\PERSONAL\garmin_and_withings\`

## What this project is
A personal health dashboard that pulls data from a **Garmin Forerunner 965** (via MTP/PowerShell bridge), **Strava** (via OAuth API, a second/independent activity source with cross-source duplicate detection), and a **Withings scale** (via OAuth API), stores everything in a local **SQLite database**, and visualises it in a React dashboard.

The user runs everything locally on **Windows 11**, uses **Git Bash** as the terminal, **Node 24 LTS**, and **WebStorm 2026.2**.


---

## Agent code of conduct (human-gated workflow) — READ FIRST

Applies to **every session in this repo**, whether or not a slash command was used, and to every
subagent spawned from one. These are constraints, not suggestions.

1. **Do not start a Story unless both `Model` (`customfield_10116`) and `Planned thinking effort`
   (`customfield_10117`) are filled.** If either is empty, STOP and ask the human to set it. An
   unfilled field means the Ready-to-Develop gate was not actually passed; starting anyway silently
   converts a human decision into an agent default.
2. **Never write the decision fields.** `Contributor Type` (`10114`), `Agent` (`10115`), `Model`
   (`10116`), `Planned thinking effort` (`10117`), `Review Outcome` (`10118`) are set by the
   **human** — at the gate, and at review. Read them; obey them; never modify them. An agent does
   not size its own compute or grade its own work.
   **The one exception is `Actual thinking effort` (`10152`): you DO fill it, at In Review, by the
   rule below.** It is a *measurement*, not a decision — and leaving it to be filled by hand means
   it gets filled only for the memorable Stories, which biases the record worse than any noise. Jira
   history shows who set it, so a human override stays visible. Fill it **by the stated criteria,
   never by impression.**
3. **Run at the `Model` and `Planned thinking effort` the Story specifies** — see the next section
   for what each value means. **State both in your first line of output**, with what they commit you
   to. An unstated effort is an unfollowed effort, and it leaves the human nothing to check but your
   word. If the level turns out to be wrong, report **observable evidence** in the In Review comment
   — which files you had to re-read, how many passes a fix took, where you stopped — so the human
   can set `Actual thinking effort` from facts rather than from your opinion of your own work.
   **Effort, like model, is launch-bound.** The runtime `/effort` dial is set by the human when the
   session starts; you run at it and never change it mid-slice. A session launched at an effort that
   does not match `Planned` is a **STOP**, exactly as a model mismatch is. The one asymmetry: you
   always know your model, but a running session **cannot reliably read its own `/effort`** (HRA-85),
   so the effort guard is a **declared launch precondition** — state the effort you were launched at,
   and STOP if you know it differs from `Planned` — not an automatic self-read. See `/implement-story`
   step 2.
4. **Stop at In Review.** Transition the Story to In Review, post a PR-style comment, then STOP.
   Nothing moves to Done. The green light is a manual human act — deliberately not automated, and
   deliberately not hooked.
5. **Implement only the slice the Story describes.** Its acceptance criteria are already approved.
   Do not re-plan, re-scope, or improve adjacent code. Anything you spot outside the slice goes at
   the bottom of the In Review comment as a *candidate*, never into the diff.
6. **API contract and client-type changes belong to Epic HRA-36**, not to whatever Story you are in.
7. **One Story per invocation.** Do not chain Stories in a single run on a promise to pause between
   them — the gate is reliable because the turn ends, not because an agent remembers to wait.

*Verification is the human's job:* at review, check Jira issue history for edits to the fields in
rule 2. A rule nobody checks is theatre.

**Policy epoch — do NOT backfill.** These fields are mandatory for Stories entering Ready to Develop
from **2026-08-12, ~17:30 CEST** (anchored to a verified Jira server timestamp, not a guessed clock
read) — the point the field design itself stabilized, after several same-day revisions (Cost Tier →
Planned/Actual thinking effort; the option set changed from three to six to the final five; option
ids were only fully captured at this point). A bare date would be misleading: a Story groomed earlier
the same day was groomed against a design that did not yet exist. Nulls on issues from before this
point (e.g. HRA-64, and any Story groomed earlier on 2026-08-12) are **pre-policy, not violations**,
and must never be filled in retrospectively. A backfilled value records a reconstruction made with
hindsight, is indistinguishable from a real one once written, and silently corrupts the only thing
these fields are for — measuring how well a human's *up-front* call matched what the work needed.

---

## Editing discipline — no blind, line-number-based file mutation

**Never edit a tracked source file via raw shell line-number operations** —
`awk 'NR>=X&&NR<=Y{next}{print}' file > tmp && mv tmp file`, `sed -i 'X,Yd'`, and equivalents. These
have no anchor to actual content: if the file drifted even one line since it was last read — another
edit, a formatter, a rebase — the wrong block is deleted silently, with **no error**. A manual
"boundary check" (`sed -n 'X,Yp'` after the fact) is a symptom of this risk, not a mitigation for
it — by the time you're eyeballing a range to confirm it, the tool you should have used would have
made that check structural instead of optional.

**Use the Edit tool instead.** It matches an exact `old_string` against the live file and **fails
loudly** if that content is no longer there — content-anchored, not line-number-anchored, so drift
is caught rather than silently acted on. Reserve raw Bash file mutation for cases with no
content-aware tool available (verified 2026-08-14 not to have caused harm on `OverviewTab.tsx` /
HRA-70's extraction — this time — see HRA-90).

---

## Shell discipline — use `git -C`, not `cd && git`

**Never run `cd <dir> && git <cmd>`.** Claude Code flags it as "changes directory before running
git" — a static, syntactic guard (it can't tell a trusted local repo from an untrusted one, so it
fires on every such compound regardless of which git subcommand follows). **Use `git -C <dir>
<cmd>` instead** — same result, doesn't trip the guard, and collapses to one atomic command besides
(HRA-91).

---

## `Model`, `Planned` and `Actual thinking effort` — what the values commit you to

Three fields, three different owners and mechanics. Confusing them is how rule 3 becomes decorative:

- **`Model` (`10116`) is not agent-actionable.** It is bound when the session launches. You cannot
  change the model you are running on. **Read it, compare it to the model you are actually running
  as, and STOP if they differ** — report the mismatch and let the human relaunch. Never proceed on
  the wrong model and never write the field to match reality.
- **`Planned thinking effort` (`10117`) IS agent-actionable.** Set by the human at Gate 1. It is the
  one *you* execute: it governs deliberation, exploration breadth, and verification depth. **But the
  runtime effort *dial* is launch-bound like the model** — you run at what the human launched and
  never change it mid-slice; a session launched at an effort that doesn't match this field is a
  **STOP** (rule 3). What is agent-actionable is *carrying out* the level's commitments, not *setting*
  the dial.
- **`Actual thinking effort` (`10152`) is a measurement you record at In Review.** What the work
  turned out to need. Set it **by the criteria below**, and state in the comment which criterion
  fired. The human overrides if they disagree — Jira history keeps the two visibly distinct.

  **Decide it by rule, not by impression.** Left to impression you will under-report over-tiering:
  under-tiering announces itself (you get stuck), while over-tiering feels like competence, and
  "the level was right" is always the comfortable answer after spending it. Over-tiering is the one
  error nothing else in this workflow catches, so it is the one the rule has to protect.

  | Set `Actual` … | when ANY of these is true |
  |---|---|
  | **above** `Planned` | you read files the Story did not name · a fix took more than two attempts · you had to stop and ask · you discovered a constraint the Story did not mention |
  | **below** `Planned` | no exploration beyond the named files was needed · no alternative was seriously weighed · the first attempt passed its acceptance criteria unchanged |
  | **equal** to `Planned` | neither list fired |

  Report the facts in the comment either way — passes taken, unnamed files opened, where you
  stopped — so the human can check the value against the evidence rather than take your word.

  Both effort fields carry the **same option set** — if the lists ever diverge, planned and actual
  stop being comparable and the metric dies silently.

### `Model` (`customfield_10116`)

| Value | Use for |
|---|---|
| `claude-opus-5` | Planning, design, ambiguous specs, high blast radius — anything where the *approach* is the hard part. |
| `claude-sonnet-5` | Implementing an approved slice whose acceptance criteria are the oracle. |

### `Planned thinking effort` (`customfield_10117`)

Five levels, using the API's own values verbatim — **`low` · `medium` · `high` · `xhigh` · `max`** —
so the field value *is* the effort setting, with no translation step. (Vendor coupling is deliberate
debt: Epic **HRA-82**.) Each level is defined by **what you do**, not by how much you think. Read the
level, then obey its row.

The ladder is **ordered**: `low < medium < high < xhigh < max`. That ordering is what makes the
planned-vs-actual delta computable as higher / matched / lower.

> **One axis per select.** These fields hold **one ordered dimension** and nothing else. Anything
> orthogonal — a technique, a mode, a flag — goes in a **Jira label**, never in this option list.
> `ultrathink` is the worked example: it is a prompt-level trigger, not an API effort value (it does
> not change the effort parameter), it can be used *at any level*, and it has no place on the ladder.
> Putting it in the select would make the delta ambiguous exactly at the top of the range, where the
> spend is highest. If it ever needs recording, use `labels: [ultrathink]`.

The levels differ in *kind*, not only degree: **`high` buys depth of judgment · `xhigh` buys coverage
over a large surface · `max` buys independent verification.** Effort is *"a behavioral signal, not a
strict token budget"* (official docs) — so these rows describe commitments, not budgets.

**low** — *the answer is obvious before you start.*
- Act directly. No extended thinking, no plan.
- Touch only the files the Story names. No exploration, no subagents.
- Run the existing suite.
- Do **not** improve anything you pass on the way.

**medium** — *an approved slice with verifiable criteria: routine refactor, everyday implementation.*
- State a one-paragraph plan before editing.
- Read the slice plus its immediate callers. No subagents.
- Suite + typecheck, then walk each acceptance criterion and say how it was met.

**high** — *the approach is not settled: complex code, a real design choice inside the slice.*
- Ultrathink. **Name at least one alternative and say why you rejected it** — in the comment, not
  only in your head.
- Broad exploration allowed. Subagents permitted for read-only investigation.
- Suite + typecheck + a live or manual check wherever behaviour is observable.
- State what could still be wrong.

**xhigh** — *large, long-running, multi-file: migrations and sweeping changes where the risk is
missing something, not choosing wrongly.*
- Everything at `high`, plus the distinguishing commitment: **prove coverage, don't assert it.**
- **Enumerate the full change set BEFORE editing and state the count.** Work in verifiable batches.
- Re-run the enumeration at the end and show the count reached zero — grep/AST evidence, not
  "I believe I got them all".
- Any site you deliberately skipped is listed explicitly, with the reason.

**max** — *brutal debugging, or a critical design flaw. You do not yet know what is wrong, or being
wrong is expensive.*
- Everything at `high`, plus: **form a hypothesis and try to falsify it before fixing anything.**
- Cross-check with a genuinely independent method — a subagent investigating in parallel, or
  `llm-council` — not a second pass of your own reasoning.
- **No fix lands without a reproduction that fails before and passes after.**
- Report what you ruled out and why, not only what you found.
- **Stop rule:** if you cannot reproduce it, STOP and report. Never fix blind at this level — a
  speculative fix on a critical flaw is worse than no fix, because it ends the investigation.

**Every level above assumes the Story is right and asks how to do it well.** Questioning whether it
is the right problem at all is a different *kind* of work, not a higher effort — it belongs to
`Category = Research/Spike`, at whatever effort. See the Category rule below.

**Default: `claude-sonnet-5` + `medium`.** Raise the level only when the slice **defines** the oracle
(a test baseline, the first slice of an epic) or when failure would be **silent** (a load-bearing
constraint no test guards).

⚠️ **Our default is deliberately one notch below the vendor's.** Per the official effort docs,
`high` **is** the API and Claude Code default for Sonnet 5 — omitting the parameter and setting
`high` are identical. Stepping down to `medium` is therefore a conscious deviation, and the
justification is specific: here the Epic and Story have already absorbed the expensive thinking. The
approach is decided, the criteria are written, and the oracle has moved from the model's judgment to
the acceptance criteria. **That displacement is the whole point of the operating model** — the
human's up-front work is what buys the right to spend less per slice. The docs' own calibration
supports it: on Sonnet 5, `medium` is described as *"comparable to Claude Sonnet 4.6 at high
effort"* — a step down from today's default, not a weak setting.

**If `medium` is genuinely not enough for an approved slice, the Story is under-specified — fix the
Story, not the level.**

⚠️ **More effort is not monotonically better.** The docs warn that `max` *"adds significant cost for
relatively small quality gains, and on some structured-output or less intelligence-sensitive tasks
it can lead to overthinking."* So a high `Actual` reading is **not** automatically an argument to
raise `Planned` next time — check whether the extra spend actually bought a better outcome before
concluding it was under-tiered.

⚠️ **Hold the level constant for the whole run.** Effort is a request-level setting, and changing it
mid-conversation **invalidates the prompt cache** — every later turn pays to re-read the context.
This is a second, independent reason for rule 7 (*one Story per invocation*): the structural gate is
also the cache-efficient shape.

**Never change your own effort mid-slice.** Not upward (self-raising is self-granting) and not
downward — *"this is simpler than planned"* is the **least reliable judgment you can make**: the
moments a task feels trivial are disproportionately the moments something has been missed, and the
resulting under-verification is silent. Whether to stop is decided by **how early you are**, not by
which direction is wrong:

- **Gross and early → STOP and ask.** `high` on what turns out to be a one-line change, spotted
  *before* the broad exploration and subagents run. A tier's cost is mostly front-loaded (planning,
  exploration, subagents; only deeper verification is back-loaded), so this is the one moment where
  stopping actually saves money.
- **Anything later → finish, then report.** Once the front-loaded work is spent, a round-trip
  through the human costs more than the tail it recovers — and their attention is not free either.

**Per-Story haggling is the wrong lever anyway.** Over-tiering is corrected by the human setting
`Planned` lower next time, once the planned-vs-actual delta shows a systematic pattern. One Story's
overspend is noise; ten Stories of it is a number — and acting on that number costs nothing and
risks nothing, unlike an agent trimming its own work.

**Effort is a deliberation dial, not a spend cap.** It changes how much thinking and searching
happen. It does not guarantee a cost.

---

## Skill stack (which skill governs what)
Skills are selected by their `description`; **multiple can load for one task and nothing auto-reconciles them** — so keep them **orthogonal (one authority per concern)** and treat this table as the manifest that composes them into a coherent whole. Adding a skill whose description overlaps an existing one is a smell: sharpen the description or don't install it.

| Concern | Authority skill | Scope |
|---|---|---|
| REST / HTTP API design | `rest-api-standards` | endpoints, methods, status codes, error shape (problem+json), pagination, resource naming, versioning, layer separation |
| Node/JS code style | `nodejs-code-style` *(installed global, self-authored)* | naming, const/===/async-await, named functions, require-order, explicit entry points, no module-scope side effects + ESLint/Prettier setup — code STYLE, distinct from the HTTP contract above |
| Visual / UI design (taste) | `frontend-design` | palette, typography, layout, the "signature" element, UX copy; explicitly steers away from the templated AI-generated look |
| Frontend performance (React/Next) | `vercel-react-best-practices` *(installed global)* | 70 impact-prioritised perf rules: eliminating waterfalls, bundle size, RSC caching, re-render optimization; read on-demand; self-scopes to React/Next |
| Frontend component architecture | `vercel-composition-patterns` *(installed global)* | compound components, lift state, avoid boolean-prop sprawl, React 19 APIs — the React component-design authority |
| Frontend code conventions (broader) | `frontend-standards` *(planned, not yet created)* | Vite/TS project structure + hooks/state conventions beyond composition — the FE analogue of `rest-api-standards` |
| Charts / data-viz | `dataviz` | chart-type choice, color/palette validation, accessibility (already used for the Body & Overview charts) |

**Precedence when two touch the same decision:** correctness/contract (`rest-api-standards`) **>** code structure (`frontend-standards`) **>** visual taste (`frontend-design`). A design choice never breaks the API contract or the component conventions; taste fills the space those leave free.

---

## Repository layout

```
garmin_and_withings/
├── .gitignore
├── CLAUDE.md                         # ← this file — keep up to date
├── start.sh                          # checks ports 3001+5173, starts what's missing
├── launcher.html                     # standalone status page (open in browser)
│
├── garmin-stats/                     # Node 24 backend — NO build step
│   ├── config.json                   # ← user fills in paths + credentials (gitignored)
│   ├── package.json
│   ├── tsconfig.json
│   ├── fit-archive/                  # permanent store of raw .FIT files (gitignored, never deleted)
│   ├── strava-archive/               # permanent store of raw Strava API JSON (summary+detail+streams; gitignored, never deleted)
│   ├── backgrounds/                  # uploaded custom background images for the Settings tab (gitignored)
│   └── src/                         # reorganized 2026-08-09 (Epic HRA-52) — see "src/ layout" note below
│       ├── config.ts                 # (root) loads config.json, CLI arg helpers
│       ├── db.ts                     # (root) node:sqlite schema, typed row interfaces, param builders
│       ├── server.ts                 # (root) entry: wiring only — build repos/services, start both HTTP servers (3001 API + 3002 Withings callback)
│       ├── http/                     # request pipeline: router, respond, request, context (AppContext/Handler), oauth, stream-sync, withings-callback
│       ├── controllers/              # HTTP↔domain, one per resource: activities, body, trends, settings, sync, integrations, docs
│       ├── services/                 # business logic (no http/SQL): activities, body, classification, sync, device (device.service.ts = Garmin "is it plugged in" check; was integrations.service.ts)
│       ├── repositories/             # data access — the only layer that runs SQL: activities.repo, body.repo, settings.repo
│       ├── domain/                   # pure, framework-agnostic logic (no I/O)
│       │   ├── fit-parser.ts             # binary .FIT decoder (many subtle fixes — do not simplify)
│       │   ├── fit-file-parser-validate.ts  # cross-validates fit-parser.ts vs the fit-file-parser npm dep (never persists)
│       │   ├── workout-metrics.ts        # reduces track_points into a compact summary (pace stdev, pauses, splits) for the classifier
│       │   └── stats-classifier.ts       # deterministic, no-LLM workout classifier over the same summary
│       ├── integrations/             # external-service clients (module = noun)
│       │   ├── withings.ts               # Withings OAuth+token client (was withings-auth.ts)
│       │   ├── strava.ts                 # Strava OAuth+token client, rotating refresh token (was strava-auth.ts)
│       │   └── ollama.ts                 # local Ollama classifier client (was ollama-service.ts)
│       ├── jobs/                     # runnable batch / CLI — spawned by the server or run via npm (command = verb)
│       │   ├── sync-garmin.ts            # PowerShell MTP bridge → SQLite (spawns powershell/activities-file-extractor.ps1)
│       │   ├── sync-withings.ts          # Withings API → SQLite
│       │   ├── sync-strava.ts            # Strava API → SQLite (+ track_points from streams, raw JSON archive, cross-source dedup)
│       │   ├── reprocess-fit-archive.ts  # one-time backfill: re-parse fit-archive/*.fit with current domain/fit-parser.ts (`npm run reprocess:fit`)
│       │   └── withings-login.ts         # standalone CLI OAuth flow, port 3002 (was auth-withings.ts; `npm run withings:login`) — don't run alongside server.ts
│       ├── powershell/               # native PowerShell helpers — spawned; take -Target/-ExistingJsonFiles as args, no self-relative paths
│       │   ├── activities-file-extractor.ps1  # MTP file copy off the watch, called by jobs/sync-garmin.ts
│       │   └── check-garmin-device.ps1        # lightweight "is the watch plugged in" check, no copying
│       └── @types/                   # ambient type declarations (webmtp.d.ts)
│
└── garmin-dashboard/                 # Vite 8 + React 19 + TypeScript 6 frontend
    ├── vite.config.ts                # proxies /api/* → localhost:3001, @/ alias
    ├── tsconfig.json                 # types: ["vite/client"]
    ├── tsconfig.node.json            # types: ["node"] — covers vite.config.ts only
    └── src/
        ├── main.tsx
        ├── App.tsx                   # tab routing; tabs render as {tab === "x" && <XTab/>} — a real
        │                              #   unmount/remount, not a hide (load-bearing, see below)
        ├── index.css                 # CSS variables, 4 themes via [data-theme="…"] blocks — see "Appearance" below
        ├── api/client.ts             # all fetch calls — GET + POST/PUT + DELETE methods
        ├── types/api.ts              # shared types mirroring DB schema
        ├── hooks/
        │   ├── useQuery.ts           # fires fn on every deps change (plain useEffect) — no `auto`
        │   │                         #   param, no manual "Load" step
        │   ├── useDateRange.ts       # date range state + presets
        │   └── useAppearance.ts      # fetches + immediately applies theme/background/unit system; see "Appearance" below
        ├── utils/
        │   ├── fmt.ts                # fmtPace, fmtDuration, fmtKm, fmtWeight, fmtElevation, fmtSpeed — all unit-system-aware, see "Units" below
        │   ├── units.ts              # metric/imperial state + conversions + locale-based auto-detect
        │   └── backgrounds.ts        # bundled background-picture presets (CSS gradients, not photo files)
        └── components/
            ├── ui.tsx                # Card, Stat, StatGrid, Badge, Empty, ErrorBanner, Pagination…
            ├── DateRangeBar.tsx
            ├── OverviewTab.tsx       # tab label "Overview & Trends" — absorbed the former TrendsTab.tsx (deleted)
            ├── ActivitiesTab.tsx     # paginated list → accordion (default) or ActivityModal popup, per activity_detail_view setting
            ├── ActivityModal.tsx     # exports ActivityDetailBody (the actual detail content — stats + charts + delete) and ActivityModal (popup chrome wrapping it); see "Activity detail chart" below
            ├── BodyTab.tsx           # Withings body metrics (indexed overlay chart) + correlation chart
            ├── ManageTab.tsx         # sync trigger (device/token status-gated), login popup, delete range (soft), trash (restore/purge) — tab label "Data & Sync"
            └── SettingsTab.tsx       # outlier-detection thresholds, trend threshold, activity detail view, appearance (theme, background, units), persisted server-side
```

**src/ layout (Epic HRA-52, 2026-08-09).** Only `config.ts`, `db.ts`, `server.ts` sit at `src/` root; everything else is grouped by concern. The layered request pipeline is `http/` → `controllers/` → `services/` → `repositories/`. Beyond that: `domain/` = pure logic (no I/O), `integrations/` = external-service clients, `jobs/` = runnable batch/CLI (spawned by the server or run via npm), `powershell/` = the two `.ps1` MTP helpers. Naming rule: **module = noun** (`integrations/withings.ts`, the client), **command = verb** (`jobs/withings-login.ts`, the CLI). Renames from the reorg: `withings-auth.ts`→`integrations/withings.ts`, `strava-auth.ts`→`integrations/strava.ts`, `ollama-service.ts`→`integrations/ollama.ts`, `auth-withings.ts`→`jobs/withings-login.ts` (npm `auth:withings`→`withings:login`), `services/integrations.service.ts`→`services/device.service.ts`. Jobs anchor data dirs via `__dirname` at the new depth (`../../fit-archive` etc.); `scriptsDir` injected into services stays `src/` (the `.ps1` join adds `powershell/`, the sync scriptName strings add `jobs/`).

---

## Stack & constraints

### Backend (`garmin-stats/`)
- **Runtime**: Node 24 — runs `.ts` files natively, no compilation needed
- **SQLite**: `node:sqlite` (built-in) — **no `better-sqlite3`**, no native addons
- **No other runtime dependencies** — only `typescript` + `@types/node` as devDeps, with **one deliberate exception**: `fit-file-parser` (real npm dep, pulls in `buffer`), added purely as a second, independent FIT decoder for cross-validating `fit-parser.ts`'s output — see "FIT parser cross-validation" below. It is never the parser whose output gets persisted.
- **Module system**: ESM (`"type": "module"`) with `"module": "NodeNext"` in tsconfig
- **Imports**: must use `.ts` extension explicitly (e.g. `from "./config.ts"`)
- **`__dirname`**: not available in ESM — always use:
  ```ts
  import { fileURLToPath } from "url";
  const __filename = fileURLToPath(import.meta.url);
  const __dirname  = path.dirname(__filename);
  ```
- **SQLite params**: use `$param` named syntax; always use typed param builder functions from `db.ts` (`activityParams`, `trackPointParams`, `bodyMeasurementParams`) — never cast to `Record<string, unknown>`
- **Run scripts**: `node src/server.ts`, `node src/sync-garmin.ts`, etc.
- **Auto-reload**: unlike the frontend (Vite HMR), the backend does not reload on file changes by default. Use `npm run server:watch` (`node --watch src/server.ts`) during development to auto-restart on save.

### Frontend (`garmin-dashboard/`)
- **Vite 8** + `@vitejs/plugin-react` v6 (Oxc built-in, no Babel)
- **React 19** strict mode (upgraded from 18 on 2026-08-12 — a bump, not a modernization)
- **TypeScript 6** strict
- **Recharts 3** for all charts
- **Tailwind + shadcn/ui** (adopted 2026-08-15 for Initiative C — supersedes the earlier "no CSS
  framework, CSS variables only" constraint, which held through Initiative B). Tokens still govern:
  colors/spacing/type come from CSS variables + the Tailwind scale, no ad-hoc hex, no arbitrary
  sizes (`text-[13px]` forbidden — extend the scale instead). Full design-system rules live in
  `docs/frontend.md` once Initiative C's plan lands there; until then see the Initiative C
  Confluence plan.
- **Path alias**: `@/` → `src/` (configured in both `vite.config.ts` and `tsconfig.json`)
- **`import.meta.env`**: typed via `"types": ["vite/client"]` in `tsconfig.json`
- **`useQuery` fetches on every deps change** (a plain `useEffect`, no `auto`/manual-load step) — see
  `docs/frontend.md` for the hook. Data loads whenever its deps (e.g. the date range) change.
- **⚠️ LOAD-BEARING: tabs are conditionally rendered, not hidden — do not "optimise" this.**
  `App.tsx` renders each tab as `{tab === "x" && <XTab/>}`. That is a real unmount/remount on every
  tab switch, and `utils/units.ts` holds the resolved unit system in **module scope** — a tab only
  picks up a unit-system change *because* switching tabs is a genuine remount, not a hide. Keeping
  tabs mounted and toggling visibility with CSS, or memoising a tab subtree so it survives a switch,
  would silently break unit propagation with no test or type error to catch it. See Epic **HRA-65**,
  which forbids exactly this "optimisation" for the same reason.
- **No `localStorage`** or browser storage APIs

---

## Known issues / open tasks

1. **`start.sh` may need `--experimental-sqlite`** flag for older Node 24 minors. If server fails to start, try: `node --experimental-sqlite src/server.ts`.

2. **`POST /api/sync/withings` has not been live-tested end-to-end** — do not care about the Withings test for now.

2b. **Strava integration is implemented but not yet live-tested** — `config.json`'s `strava.client_id`/`client_secret` are still placeholders (`YOUR_STRAVA_CLIENT_ID`/`YOUR_STRAVA_CLIENT_SECRET`). Create an app at https://www.strava.com/settings/api (Authorization Callback Domain = `localhost`), fill in the real values, restart the server, then test the "Login to Strava" popup → sync flow end-to-end. Backend routes/status checks were verified live against the placeholder config (correctly report `present:false`/return a well-formed auth URL); the actual OAuth exchange and a real sync run haven't been exercised yet.

---

## FIT parser notes — do not regress

- **Base type mask must be `0x1f`** (not `0x9f`)
- **sport** is session field **5** (not 2)
- **avg/max speed**: use enhanced fields **124/125** when legacy fields 14/15 = `0xFFFF`
- **enhanced_speed** in records is field **73** (not 82)
- **Running cadence, per-record** (field 4, `cadence`): single-leg strides/min, same convention as Strava's cadence stream — **× 2 for running** to get steps/min (applied in `fit-parser.ts` itself now, not left to callers)
- **`avg_cadence` (activity-level)**: do NOT trust session fields 56/`avg_cadence` or 89/`avg_running_cadence` — on real files these produced nonsense (e.g. 1684 spm on a run that averaged 170). Computed instead as the mean of the already-scaled per-record `cadence` values (see `parseFit()`) — validated against several real archived activities, all landing in a sane 150-190 spm range
- **`total_ascent`/`total_descent` are session fields 22/23** (not 24/25 — the same class of off-by-N field mismap as cadence's 56/89 above). Confirmed by dumping every raw numbered session field for a real file and matching against its known-correct ascent/descent (31m/24m): field 22 held 31, field 23 held 24, while the old 24/25 mapping read 36/0.
- **activity_date**: from session `start_time` (field 2)
- **Developer fields** (`hasDev`): both halves must be skipped, or the parser loses byte alignment — (1) each field's 3-byte descriptor in the *definition* message (`field_num, size, dev_data_index`), and (2) critically, **the developer fields' actual payload bytes appended after the fixed fields in the matching *data* message** (fixed 2026-08-06 — the original code only did (1), recording that dev fields existed but never their sizes, so data-message reads silently ran short by the unaccounted payload length). Confirmed via a byte-level trace on a real archived file: a single unaccounted 14-byte dev payload on a session message corrupted the global-message-number of every message read after it for the rest of the file (e.g. one came out as `30466`, not a real FIT message type) — no `record` message was ever read correctly again, so the activity parsed with a normal-looking summary but **0 track points**. This affected most of the archive (developer fields are common on Forerunner 965 files via running-dynamics extensions) and matched the live DB before the fix (most Garmin activities had empty `track_points`). Now fixed by summing each local message type's declared dev-field sizes in the definition branch and skipping that many extra bytes after the fixed fields in the data branch. Backfilled into the live DB via `npm run reprocess:fit` (200/200 files updated, 0 errors); the reference activity below was re-verified unaffected by the fix (its own ascent/descent/duration/moving-time all still match exactly, since it never had a desyncing dev field).
- **Invalid sentinels**: `0xFF`, `0xFFFF`, `0xFFFFFFFF` filtered via `validNum()`
- **`moving_time_sec`** (session field 8, `total_timer_time`) is the activity-level moving/active time excluding auto-paused stretches — distinct from `duration_sec` (session field 7, `total_elapsed_time`, total wall-clock time). Both are ms, divide by 1000.
- **Per-record `timestamp_unix`** (record field **253**, `uint32` FIT-epoch seconds) is real wall-clock time and always advances — the only trustworthy per-record time source. **Per-record `elapsed_sec` (field 29, `elapsed_time`, ms) is NOT a reliable moving/timer clock** — an earlier version of this note assumed it tracked moving time and only froze during pauses, but on real data it lags wall-clock at a roughly constant ~20-30% rate for the *entire* activity, not just during pauses (confirmed on a real 50:35 activity: its last point's `elapsed_sec` read only 10:44). Whatever field 29 actually represents, it isn't per-record elapsed/moving time, and nothing should compute a pause duration or a time-mode chart axis from it. Use `timestamp_unix` deltas directly instead: this device stops recording entirely during an auto-pause (no frozen-clock samples in between), so a plain gap ≥ threshold between two *consecutive* recorded points' `timestamp_unix` values IS the pause, no heuristics needed. Confirmed against a real archived activity's FIT data (2026-08-04): this found 5 real pauses totalling ~14.6min, matching that activity's own `duration_sec − moving_time_sec` gap almost exactly. `elapsed_sec` remains useful only as a last-resort fallback (e.g. for Strava, whose `time` stream genuinely is real elapsed seconds, or pre-timestamp_unix Garmin rows).

---

## Routing table — where the detail lives

`CLAUDE.md` holds only what PREVENTS a mistake. Everything that DESCRIBES the system lives in
`docs/` — meaning **repo-root `garmin_and_withings/docs/`**, NOT `garmin-stats/docs/` (there is no
such dir) — and is read on demand. **Read the relevant file before working in that area** — do not
re-derive it from the source, and do not assume the summary above is complete.

| Working on… | Read |
|---|---|
| DB schema, columns, soft delete / trash / purge semantics | `docs/schema.md` |
| HTTP endpoints — paths, bodies, status codes, CORS | `docs/api.md` |
| Garmin MTP sync, Withings OAuth, Strava sync, FIT cross-validation | `docs/ingestion.md` |
| Any React component, chart, theme, units, CSS tokens | `docs/frontend.md` |
| Workout classification (Ollama + statistical) | `docs/classifier.md` |

**Rule:** a section unreachable from this table is a section nobody will ever load. If you move
something out of `CLAUDE.md`, it goes in `docs/` *and* gets a row here — or it does not move.

---

## Jira quick reference (project HRA)

Kanban: Backlog → Refinement → Ready to Develop (Gate 1) → In Progress → In Review (Gate 2) → Done.
Portfolio-facing writeup: `PROJECT-OVERVIEW.md`.

- **IDs:** cloudId `2e4f6af1-c76d-45be-9a00-ca9f30589199` · project id `10067` · issue types Epic
  `10114`, Story `10117` · transition to Done = id `41`.
- **`createIssueLink` direction — counter-intuitive, verified wrong once (2026-08-15).** For the
  `Blocks` type, `inwardIssue` = the issue that **blocks**, `outwardIssue` = the issue that **is
  blocked** (e.g. "A is blocked by B" → `inwardIssue: B, outwardIssue: A`). This is the *opposite*
  of what a naive reading of `getIssueLinkTypes`' own `{inward: "is blocked by", outward: "blocks"}`
  suggests — that field describes the *phrase*, not which parameter produces which role, and
  reasoning from it directly produced backwards links (HRA-94↔HRA-95/96/97/98) that looked
  self-consistent in the API response and were still wrong. **Verify link direction visually in the
  Jira UI after creating — not via another API read, which is exactly what failed here.**
- **Custom fields** (project-scoped, single-select) — **not on the create/edit screen**, so
  `getJiraIssueTypeMetaWithFields`/`editmeta` omit them, but they CAN be set by passing
  `{ "customfield_101xx": { "value": "<option>" } }` in `createJiraIssue`'s `additional_fields` or
  `editJiraIssue`'s `fields`. **Option matching is CASE-SENSITIVE and exact** — a casing mismatch
  fails with the same "Select a valid option" error as a genuinely missing option, so that error is
  *not* evidence the option doesn't exist. **Prefer `{ "id": "<optionId>" }` over `{ "value": … }`**
  where the id is known below — ids can't be mis-cased. The MCP tools cannot add options; that is a
  Jira-admin action.

  | Field | ID | Options |
  |---|---|---|
  | `Contributor Type` | `customfield_10114` | Human · AI · Hybrid *(casing unverified)* |
  | `Agent` | `customfield_10115` | e.g. "Claude Code" *(casing unverified)* |
  | `Model` | `customfield_10116` | e.g. `claude-sonnet-5` *(casing unverified)* |
  | `Planned thinking effort` | `customfield_10117` | Renamed from "Cost Tier" 2026-08-12. Options = the API's five effort values verbatim, **ordered**: `low` · `medium` · `high` · `xhigh` · `max`. ✅ Full set, human-confirmed 2026-08-12: `low`=**10043** · `medium`=**10044** (unchanged from before the re-cut) · `high`=**10045** · `xhigh`=**10160** · `max`=**10087**. Ids do **NOT** mirror `10152` — confirm by field, never assume parity. |
  | `Actual thinking effort` | `customfield_10152` | New 2026-08-12. **Must carry the same option set as `10117`** (or planned-vs-actual is not comparable) — ids differ, values must not. ✅ Full set, human-confirmed 2026-08-12: `low`=**10121** · `medium`=**10122** · `high`=**10123** · `xhigh`=**10159** · `max`=**10125**. **The one field the agent writes** — at In Review, by the criteria in the effort section, never by impression. Human overrides; history keeps them distinct. |
  ℹ️ Both `xhigh` ids (10159 / 10160) are consecutive — `xhigh` was added to both fields in the same
  admin action, right after one another. Cross-checks the two sets against each other.

  ⚠️ **Both effort fields are MULTI-select, not single-select** (unlike `Category`, which is
  single-select and takes a bare object). Set them as `[{"id": "…"}]`, an array — `{"id": "…"}`
  alone fails with *"Specify the value ... in an array"*. Confirmed live on HRA-80.
  | `Review Outcome` | `customfield_10118` | Accepted · Edited · Rejected *(casing unverified)* |
  | `Category` | `customfield_10119` | ✅ `Technical Improvement` (id **10049**) · ✅ `Business Functionality` (id **10050**) · ✅ `Enabler/Infrastructure` (id **10051**) · Research/Spike · Bug *(last two: casing unverified)* |

  ✅ = exact string and option id verified against live issues (HRA-64, HRA-52, HRA-81) on
  2026-08-12. Anything marked *casing unverified* is a claim inherited from an older revision of
  this file — read an existing issue's field value before trusting it (test 4 of the Maintenance
  rule). **Option labels can be renamed in Jira admin without the id changing** (10051 was
  `Enabler/infrastructure` earlier the same day), which is exactly why you pass ids: a rename then
  costs nothing anywhere except this table.

- **`Category` rule (user-set, keep applying it):** pick `Business Functionality` whenever the work
  is something the **end user actually uses/sees** (any UI tab, a user-facing feature, a
  classification method the user consumes — the Settings tab and the statistical classifier both
  count). Reserve `Technical Improvement` for work with **no end-user impact** — refactors,
  internal plumbing, perf-only changes. In doubt: "does the runner touch this?" → yes = Business
  Functionality.
- **`Enabler/Infrastructure` vs `Technical Improvement` (added 2026-08-12).** The rule above only
  separated end-user-facing from not, which left the two non-user-facing categories undecided.
  Second question, asked after the first: **does this change the product, or the machinery that
  builds it?**
  - **`Enabler/Infrastructure`** — makes *future delivery* possible or cheaper: repo/module
    reorganisation, test infrastructure, the context and governance files themselves, tooling.
    (HRA-52 src reorg; HRA-81 this file's slim-down.)
  - **`Technical Improvement`** — changes product code with no end-user impact: refactors,
    plumbing, perf. (HRA-64 React 19 bump; HRA-65 FE architecture.)
- **`Research/Spike` — when the uncertainty is in the QUESTION, not the answer.** Every other
  Category assumes the Story is right and asks how to do it well. This one asks whether it should be
  done at all, and in this shape. It is a *kind of work*, not a higher effort level — a spike can run
  at any effort. When working a Spike:
  - Before proposing anything, state **what would make this the wrong problem to solve**, and what
    you would expect to observe if the framing were mistaken.
  - Bring independent perspectives (subagents, `llm-council`) to the **framing**, not only the
    solution.
  - Output a recommendation *with* its strongest counter-argument, and name the evidence that would
    change your mind. If the answer is "re-scope this", say so and stop.
  - **Precedent: HRA-40** — every test green, every action individually reasonable, and the *spec*
    was what was wrong. That failure is invisible to any amount of effort spent inside the wrong
    frame.
- **Attribution convention:** Epics = `Contributor Type: Human` (the epic is the human's intent —
  leave Agent/Model blank); Stories = `Hybrid`. Per the code of conduct, **the human sets these at
  review — an agent never writes them.**

---

## Maintenance — how this file stays small

**This file is loaded in full, every session, before anything is asked.** It earns its size by
being rules only. Historically it did not: an earlier version of this rule said only *"at the end
of every session, update this file"* — pure accretion, no eviction — and it grew to 15,372 words,
of which just 7% were rules. Every addition was individually correct. The file got worse one good
decision at a time.

So the rule now has both halves:

1. **Add**, at the end of a session, anything learned that would PREVENT a future mistake.
2. **Evict**, in the same pass, by these three tests:
   - **Prevent vs describe.** Does the section stop someone doing the wrong thing, or does it
     explain how the thing works? Prevention stays. Description moves to `docs/`.
   - **Reachability.** Anything moved to `docs/` must get a row in the routing table above. No row
     = invisible = effectively deleted.
   - **Settled history is deleted, not moved.** "Fixed on date X", "the earlier note is obsolete",
     "resolved at creation time" — that is what `git log` is for. Delete it.
   - **Verify before you keep.** Any claim naming a file, hook, flag, script or npm command must be
     grep-checked against the actual tree in the same pass. The first three tests sort by
     *function*; this one sorts by *truth*, and it is the one that matters most: a stale description
     gets ignored, a **stale rule gets acted on**. An unverified claim in this file is a liability,
     not context. (This test exists because the split of 2026-08-12 preserved a claim about
     `useQuery`'s `auto=false`/`loadKey` that had not been true for some time — see HRA-80.)
3. **Status does not live here.** No "current status", no "in flight", no "awaiting review" — those
   are stale within days and Jira already holds them. Live work state belongs in Jira and in
   `sessions/*.md`.

One deliberate exception: **"FIT parser notes — do not regress"** stays resident despite its size.
It is expensive, and it is pure prevention — every line is a field number someone already got
wrong once. Function, not size, decides what stays.
