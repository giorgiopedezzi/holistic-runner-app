# RunPlan DSL — future direction notes (NOT implemented)

> **Status: discussion notes only.** Nothing in this file is built. It exists so a future session
> can pick up where this one left off, without re-deriving the reasoning. `docs/runplan-dsl.md`
> documents what's actually shipped (HRA-111/HRA-112) — read that first for current behavior; this
> file is the parking lot for what comes next. More notes are expected — the user said "I
> elaborated another strategy" and hadn't shared it yet when this file was written. Append to this
> file rather than replacing it.

## 1. Never a hard parse error — always a warning

Reverses HRA-111's mandatory-interval-rest amendment (currently `IntervalSegment.rest` is
*required*, and a missing `r:` clause is a hard `ParseError`, making the day `valid:false`).

**New rule:** nothing the parser encounters should ever produce a hard error / `valid:false`.
Missing rest, ambiguous intensity, incomplete data — all of it becomes `needs_review:true` +
a `ParseWarning`, never a rejection.

**Open question, not yet resolved:** does this mean `ParseResult`'s `ok:false` branch disappears
entirely (even empty input / a document missing the `PLAN` header degrades to a warning + an
empty/default plan shell), or does some absolute floor remain below which there's genuinely no
plan object to build? HRA-111 §15 currently reserves `ok:false` for exactly those two cases. Needs
an explicit decision before this is implemented — don't assume either answer.

## 2. Two separate gates, confirmed — save (automatic) and approval (deliberate, revocable)

**Gate 1 — save, automatic/mechanical:** zero warnings is the precondition to save at all — enables
the UI's Save button, and gates the HTTP 200 response on `POST`/`PUT`. Replaces HRA-112's current
`!ok || !plan.valid` rejection check with a warning-count check (`ok:false` stays as-is per §1's
resolution below; `plan.valid`/hard errors no longer exist as a concept once §1 lands, so the check
becomes "0 warnings across the whole tree," not "0 errors").

**Gate 2 — approval, deliberate and revocable:** a real, separate, persisted status
(`plan_templates` and `plan_instances` both need it — schema TBD, e.g. `approved_at`/`approved`),
set explicitly by the human *after* a successful (zero-warning) save. **Confirmed: any edit
afterward revokes it**, even an edit that still results in zero warnings — approval means "a human
signed off on this exact saved state," not "this happens to currently parse cleanly." The two gates
are genuinely independent: passing gate 1 is necessary to reach gate 2, but reaching gate 1 never
implies gate 2.

**Also confirmed (§1's open question, now resolved):** `ok:false` keeps exactly its current
HRA-111 triggers — empty input, or missing `PLAN` header as the first line. Nothing broader. Only
the *day/segment*-level hard errors (e.g. missing interval rest) move to warnings under §1; the
document-level "is there even a shell to build" check is unchanged.

## 3. Any day is editable pre-approval, not just flagged ones

The human review pass (accordion UI, still not built — HRA-111 was only made *consistent* with it)
must let the user amend **any** day, whether `needs_review` is set on it or not — not just the days
the parser flagged. Confirms `parseDayEntry`'s standalone-callable design (HRA-111) is the right
shape for this: re-validate one edited day without re-parsing the whole document.

**Two distinct actions confirmed, not one:**
- **"Generate"** — parse-only, no persistence. DSL text (a textarea) in, the parsed `RunPlan`
  (rendered as a hierarchical accordion) out. This is a genuinely new endpoint — HRA-112's current
  `POST /api/v1/plan-templates` conflates parse + persist into one call; "generate" needs its own
  route that returns a `ParseResult` without writing a row.
- **"Save"** — persists, gated on zero warnings (§2, gate 1). Same underlying `parseRunPlanDSL`
  call as "generate," different endpoint contract.

**Editing stays as DSL text (a textarea), not structured form fields.** Confirmed reasoning:
target users already know this notation ("almost every runner knows this notation" — the app will
add an explainer for those who don't, but won't build a structured-fields editor as the primary
path). This also sidesteps a real risk that was flagged: if editing operated on structured fields
instead, there'd be no code today to serialize a `DayEntry` back into DSL text, so `dsl_source`
could silently diverge from the parsed structure. Staying text-in/text-out avoids that entirely —
the edited line is just re-parsed, so text and structure never disagree by construction.

**"Would be nice" to validate on the fly** — re-run `parseDayEntry` (or a smaller per-line check)
as the user edits a day's text, not only at final save. Soft preference, not a hard requirement;
noted for whenever the editor gets built.

**Warning resolution = the underlying data changes, confirmed.** No separate "dismissed without
fixing" state — a warning is gone only when re-parsing/re-validating no longer produces it.

## 4. "Other activities" — a general, presence-only category

Wants a category (examples given: core, strength, cross-training — not an exhaustive/fixed list)
where **validation is just presence in the day's activity list** — no target, duration, or
intensity required at all.

This overlaps with the *existing* `cross`/`strength` `DayEntry.workout_type`s (HRA-108 §8), which
currently *require* an `activity_target` (a `Target` — distance or duration) via
`CROSS <target> <description>` / `STRENGTH <target> <description>`. The new note implies those
should generalize into one open-ended "other activity" type (free-text name, not a closed enum),
with the target/duration requirement dropped entirely — naming the activity is sufficient.

**Also stated:** these activities are excluded from the future planned-vs-actual comparison
entirely — they're a presence/absence checklist item against Garmin/Strava data, never a
pace/distance session to reconcile. Worth keeping in mind when that comparison Story eventually
gets scoped (not HRA-111/HRA-112's job, and still not this one's).

## 5. AI-assisted transcription of messy real-world plans

Context: the user is writing an LLM prompt to transcribe an existing, messy (e.g. Italian-language
PDF/prose) training plan into structured data. They shared an example output shape — session-level
`"dsl"` strings (not decomposed into typed segments), a `"format": "runplan-v1"` header, no
`SECTION` nesting, `?` placeholders for data the source material didn't specify, and a
distance-conditional percentage-blend pace type (`"FP": "<=15km: 50% FL; 35% RG; 15% RG-10; >15km:
..."`) not present anywhere in the current grammar.

**Assessment given in this session (not yet decided/confirmed by the user):**

- **`FP` doesn't need to become a real grammar/`PaceValue` feature.** The example's own FP
  sessions already arrive pre-resolved into plain segments (FP 10km → `"5km @ FL ; 3.5km @ RG ;
  1.5km @ RG-10"`, correctly matching 50/35/15%) — i.e. the AI already did the percentage-split
  math before emitting output. Recommendation: keep it that way — the AI resolves any
  conditional/percentage pace formula into literal segments at transcription time; the parser never
  needs to know "FP" exists.
- **Recommended target format for the AI's output: RunPlan DSL v1 *text*, not a separate JSON
  schema** — i.e. feed the AI's output straight into the existing `parseRunPlanDSL`, don't bypass
  it. Reasoning given: keeps one canonical format (`plan_templates.dsl_source` stays meaningful
  whether hand-typed or AI-transcribed), keeps AI upstream of the deterministic/tested parsing core
  (matches HRA-108 §23's original "no AI in the parser" intent), and lets a human review the
  x-transcribed plan as *text* rather than trusting an LLM's JSON to already satisfy every type
  invariant. **The alternative (AI emits JSON directly against the `RunPlan`/`DayEntry` schema,
  skipping `parseRunPlanDSL` entirely) was named as a real, considered option, not a strawman** —
  LLM structured-output/function-calling against a JSON schema is often more reliable than getting
  an LLM to emit precise custom-grammar text. **This choice was not confirmed by the user before
  this session ended — resolve it explicitly before building the prompt or any supporting code.**
- **One genuine grammar gap identified, needed either way if going the DSL-text route:** a literal
  `?` placeholder, valid wherever a `Target`, `Intensity`, or interval rep-count is expected —
  always accepted, always produces `needs_review` + a specific warning naming what was unclear —
  distinct from the whole-day `TODO` type that already exists, since the example shows *partial*
  ambiguity within an otherwise-fully-specified session (e.g. `"10km @ FL ; 8x? @ ?"` — the first
  segment is completely known, only the strides are not).
- Confirmed in this session: **only DSL text has ever been exercised as parser input.** All 43
  HRA-111 tests feed text strings into `parseRunPlanDSL`; nothing today accepts a `RunPlan`-shaped
  object as trusted input (the closest thing, `plan_templates.parsed_plan`, is `JSON.stringify()`'d
  *output* being stored, `JSON.parse()`'d back on read — never re-validated as untrusted input).

## 6. `plan_instances` needs its own `name` + `event`; goal↔RG conversion at instantiation

**Schema gap identified:** `plan_instances` currently has no `name` and no `event` column at all
(HRA-112 gave it `id`, `template_id`, `start_date`, `pace_overrides`, `target_activity_id`,
`created_at` — see `docs/schema.md`). Confirmed needed:

- **`name`** — a genuinely distinct value per instance, not a copy of the template's. Template name
  describes the reusable plan itself ("Albanesi 12 weeks training plan"); instance name binds it to
  a specific race ("Albanesi 12 weeks training plan for Boston 2028"). Likely a sensible default
  (template name + target race name/date) that stays user-editable, but that's a UI concern, not
  decided here.
- **`event`** — a **denormalized copy** of the template's event type (confirmed: "right guess" —
  convenience/read access, e.g. listing instances without joining back to the template each time,
  not an independently-settable value; an instance is always the same event type as its template).

**Goal ↔ `RG` conversion, scoped to instantiation (not template parsing):** the DSL's `GOAL
<HH:MM:SS>` metadata line (already implemented, `PlanMetadata.goal_time_sec`) is separate from this
— that's the template's own informational goal. This is new: **at instantiation, the caller
supplies either a goal time or an `RG` pace directly — not both required — and the missing one is
derived from the other using distance.** `RG` is always the canonical, internally-used
representation; `goal_time` is only ever an alternate *input* method, converted to `RG` at the
boundary, never itself part of pace resolution.

Distance for the conversion comes from the event's standard distance (5k=5000m, 10k=10000m,
half=21097.5m, marathon=42195m — same values already seeded in `activity_types.min_distance_m`,
reuse rather than re-derive) or `PlanMetadata.distance_m` if the template set one explicitly via
`DISTANCE`.

**Open question, not yet resolved:** `event: "ultra"` / `"custom"` has no fixed standard distance.
If neither a template `DISTANCE` nor some other distance is available, there's nothing to divide
the goal time by. Two options, not yet chosen between: (a) `goal_time` input is simply unavailable
for ultra/custom — the caller must supply `RG` directly; or (b) the instantiate call also accepts
an explicit distance override, usable for exactly this case. Needs a decision before implementation.
Note this changes the instantiate endpoint's contract from HRA-112's current shape
(`pace_overrides: {"RG": "6:40/mi"}` as the only pace-input mechanism) — a goal-time input path is
a genuinely new parameter, not a rename of an existing one.

## 7. Warnings need per-day attachment; instances can knowingly diverge from their template

**Structural gap, confirmed real:** `ParseWarning[]` is currently a flat, top-level array on
`ParseResult`, correlated to a specific day only by line number — fragile once a day gets edited
and re-parsed (line numbers shift). **Confirmed fix: `DayEntry` needs its own `warnings:
ParseWarning[]`**, the same per-node treatment `errors`/`valid` already got in HRA-111's amendment
2. **Week/section "has warnings" stays derived, never its own stored field** — exactly the same
pattern as `valid` (a week has warnings if any of its days does; a section, if any of its weeks
does) — confirmed explicitly, not left ambiguous.

**Instance edits are symmetric with template edits (§3's "generate"/"save"/zero-warnings-to-save
flow applies to instances too), and can diverge from the template on purpose.** Editing a resolved
instance day doesn't require touching or re-instantiating from the template — an instance is a real
independent artifact once created, and the user is allowed to make it drift from what the template
would currently produce. The system doesn't reconcile or warn about that divergence.

## Not yet covered by any note above

- Whether the items above become one Story or several.
- Whether HRA-111/HRA-112 (both already `In Review`, not `Done`) get amended in place or superseded
  by new Stories, given §1 reverses a decision already implemented and reviewed there.
- The exact shape of the approval-status field(s) (§2 gate 2) — column names, and whether it's a
  simple boolean or carries an `approved_by`/`approved_at` audit trail.
- The exact contract for the new "generate" (parse-only) endpoint (§3) — request/response shape,
  and whether it's a new path or a query param on the existing create route.
- §6's ultra/custom-distance question (explicit distance override at instantiate time, vs. `RG`
  being mandatory for those events) — still open.
