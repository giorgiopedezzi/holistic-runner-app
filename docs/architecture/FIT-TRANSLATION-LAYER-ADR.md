# FIT Translation Layer

> **Architecture Decision Record — Draft**
>
> Bidirectional Garmin Workout sync for the RunPlan DSL: whether to bend the core parser toward Garmin's flat step model, or isolate the impedance mismatch behind a dedicated adapter.

- **Scope:** Garmin Workout export/import (`.fit`)
- **Depends on:** `runplan/instantiate.ts`
- **New dependency proposed:** `@garmin/fitsdk`
- **Status:** Recommendation; no code changed

## Contents

1. [Executive verdict](#1-executive-verdict)
2. [Why the core DSL shouldn't bend](#2-why-the-core-dsl-shouldnt-bend)
3. [Bidirectional tradeoff matrix](#3-bidirectional-tradeoff-matrix)
4. [The five hard parts](#4-the-five-hard-parts)
5. [Interfaces & pipeline](#5-interfaces--pipeline)
6. [Open decisions — not made here](#6-open-decisions--not-made-here)

---

## 1. Executive verdict

Build **Option 2 — an isolated Garmin FIT adapter**. Keep `parser.ts`, `types.ts`, and `instantiate.ts` exactly as they are. Do not reshape the DSL's AST toward Garmin's flat, back-referencing step model.

> **Recommendation:** Anti-corruption layer, not a parser refactor.

The DSL already has the correct shape for this problem — it just doesn't know it yet. `parser.ts` produces a *symbolic* tree (`DayEntry`, paces as named anchors like `RG-20`); `instantiate.ts` resolves that tree into a *concrete* one (`ResolvedDay`, paces as `resolved_pace_sec_per_km` numbers) per race. Garmin FIT has no concept of a symbolic anchor at all — every target it stores is already a resolved number. That means `ResolvedDay`, not the parser's output, is the only valid input to a Garmin export in either option. Reshaping `parser.ts` toward Garmin doesn't remove a translation step — it just performs it one layer too early, in the one module every other feature in this app depends on.

The four hard problems this task actually poses — unit/precision loss, nested-loop unrolling, asymmetric-import handling, and the pace-ramp gap — exist under **either** option; they are properties of Garmin's model, not of how our parser is organized. Option 1 buys nothing against them while breaking template reuse, pace-anchor scoping, and the (planned) accordion review UI, all of which read the current nested shape. Full reasoning in §2; the adapter design in §5.

---

## 2. Why the core DSL shouldn't bend

### 2.1 The DSL is already two layers, on purpose — and Garmin only ever sees the second one

A template's `DayEntry` carries `Intensity` as `anchor | offset | absolute | unknown` — paces stay symbolic (`RG-20`) so one plan can be reused across races via `pace_overrides`/`goal_time`. `instantiate.ts` resolves that into `ResolvedDay`/`ResolvedSegment`, where every intensity is a concrete `resolved_pace_sec_per_km`. Garmin FIT step targets are always a concrete speed range — there is no wire format for "this pace depends on your goal time." So a Garmin-flavored parser output is a contradiction: the parser runs at template time, before any race-specific pace exists to put in it.

### 2.2 The reorg would land in the one module everything else depends on

Section/week pace scoping (`pace.ts`), the day-edit patch surface (`runplan-patch.ts`), plan-level rollups (`runplan-aggregate.ts`), and the not-yet-built accordion review UI all read the current nested `IntervalSegment` (work + optional rest, one object). Flattening that into Garmin's step-and-repeat-marker sequence to satisfy one downstream vendor pushes every one of those consumers to re-nest it right back — the translation doesn't disappear, it just moves earlier and gets duplicated at each read site instead of living in one adapter.

### 2.3 This is exactly what the repo's existing layering already does elsewhere

`domain/` holds pure transforms with no I/O (`fit-parser.ts`, `workout-metrics.ts`); `integrations/` holds one file per external vendor, named as a noun (`strava.ts`, `withings.ts`, `ollama.ts`). A Garmin workout adapter is that same pattern applied to a new vendor — not a new architectural idea introduced for this feature, just consistency with the convention the codebase already enforces.

### 2.4 The multi-vendor future is the strongest argument against a Garmin-shaped core

Apple's structured-workout model and Wahoo's plan JSON both have their own step/repeat conventions, none identical to Garmin's index-back-reference repeat step. A core shaped around Garmin's specific quirks means every future vendor first has to translate *away from Garmin* before it can translate to its own format — you still end up writing an adapter, just a worse one (DSL → Garmin-shaped-core → neutral → OtherVendor instead of DSL → OtherVendor directly). This is precisely the case an anti-corruption layer exists for: the core domain model should not carry the constraints of one integration partner.

Where Option 1 *would* be defensible: a single-vendor tool with no template/instance split and no other reader of the AST. None of that is true here.

---

## 3. Bidirectional tradeoff matrix

Scored specifically on the mechanics of round-tripping data through Garmin's format — not general code taste.

| Dimension | Option 1 — Garmin-shaped core | Option 2 — isolated adapter |
|---|---|---|
| **Frontend impact** | **✕** every renderer of `IntervalSegment` (agenda cell, planned accordion UI) must learn the flat step+repeat-marker shape, or a second de-flattening layer is written anyway — reintroducing the adapter under a different name. | **✓** zero. Frontend never sees a FIT-shaped object; the adapter's output surface is `ResolvedDay`/`DayEntry`, already what the UI renders. |
| **m/s ↔ sec/km precision** | Same rounding-loss problem, still unresolved — it's inherent to FIT's integer-scaled speed field, not to where the conversion code lives. | Same problem, but isolated to one tested module (§4.1) instead of leaking into every call site that touches a pace. |
| **Loop reconstruction (import)** | No improvement — flattening the *outbound* shape says nothing about how to safely re-nest an *inbound* flat sequence back into a tree. | Owned entirely by one importer (§4.3): walk, detect repeat markers, classify the body, fall back explicitly when it doesn't fit. |
| **Asymmetric / non-standard import** | Has nowhere principled to put a workout that doesn't reduce to the DSL's shapes — the core model *is* the DSL's shapes now, so a mismatch has no home. | Falls back to a preserved, opaque block (§4.3) that reuses the DSL's existing `needs_review`/`ParseWarning` convention. Nothing new for the UI to learn. |
| **Multi-vendor future** | **✕** core model now carries Garmin's specific repeat-by-back-reference convention; every other vendor inherits that bias. | **✓** core stays vendor-neutral; each vendor gets its own adapter under `integrations/`. |
| **Blast radius of a Garmin SDK bump** | Touches the parser, its tests, and every consumer of its output. | Touches one integration file and its domain-layer transform pair. |
| **Effort to ship v1** | Deceptively larger — the parser rewrite is real work *and* the adapter still has to exist for the frontend's benefit. | Contained: two new domain files + one integration file, no change to existing modules. |

---

## 4. The five hard parts

These are Garmin-model problems, not parser-organization problems — they must be solved under either option, and they are what the adapter in §5 is actually for.

### 4.1 Precision loss: sec/km ↔ m/s

FIT speed targets are stored as an integer scaled by 1000 (i.e. the wire value is `round(speed_ms * 1000)`, unscaled by dividing by 1000 on read) — a documented convention across FIT speed fields, but **confirm the exact scale/offset for the specific step-target fields against the installed package's shipped profile before relying on it**, not from memory (see the callout at the end of this section). The quantization step is therefore 0.001 m/s, so the worst-case rounding error is ±0.0005 m/s.

Error bound — `pace ≈ 1000 / speed`, so `d(pace)/d(speed) ≈ −1000 / speed²`:

```text
speed range for a real run:        3–6 m/s   (≈ 3:00–5:30 /km)
max rounding error in speed:        ±0.0005 m/s
⇒ max round-trip error in pace:     1000 × 0.0005 / speed²
                                    ≈ ±0.02–0.06 sec/km

Invisible at any precision the DSL displays. But it is not zero —
never assert exact equality after a round trip in tests; assert within an
epsilon (e.g. 0.1 sec/km), and never let a reconstructed DSL string print
false precision the user never typed ("4:15.3/km" from an import).
```

> **Verify, don't memorize.**
>
> This project's own `fit-parser.ts` shipped multiple field-number mismaps before being corrected (session field 22/23 vs. 24/25, base-type mask `0x1f` vs `0x9f` — see `CLAUDE.md`'s "FIT parser notes"). That parser was hand-rolled against field numbers recalled from the spec. The workout adapter should not repeat that failure mode: read `durationType`/`targetType`/`customTargetValueLow`/`customTargetValueHigh` scale and offset straight from `@garmin/fitsdk`'s shipped profile (or `Profile.xlsx` where the JS profile is ambiguous), never from a remembered constant.

### 4.2 Unrolling a nested interval into flat steps + a repeat marker (export)

Garmin has no parent/child step container. A "repeat" is itself just another `WORKOUT_STEP` row, placed *after* the steps it repeats, whose `durationType` is one of the `repeatUntil…` variants: its `durationValue` holds the `messageIndex` to loop back to, and its `targetValue` holds the repeat count. The DSL's single nested `IntervalSegment` becomes either 2 or 3 flat rows, depending only on whether HRA-113's optional `r:` rest clause was present.

| DSL segment | Emitted `WORKOUT_STEP` rows |
|---|---|
| **ContinuousSegment** | 1 row — `intensity: active`, `targetType: speed` |
| **IntervalSegment with rest** | 3 rows — [0] work (`intensity: interval`) → [1] rest (`intensity: rest`) → [2] repeat marker (`durationType: repeatUntilStepsCmplt`, `durationValue: 0`, `targetValue: reps`) |
| **IntervalSegment without rest** | 2 rows — [0] work → [1] repeat marker (`durationValue: 0`, `targetValue: reps`). The rest-less interval HRA-113 already allows with a warning needs no special case here — a repeat can loop over a single step. |
| **ProgressionSegment** | 1 row, **lossy** — see 4.4. |
| **RestBlockSegment** | 1 row — `intensity: rest`, no repeat wrapper. |

### 4.3 Rerolling flat steps back into the DSL, and the asymmetric-import case

Import runs the inverse walk. The interesting failure mode is a workout built in Garmin Connect, or by a coach, that doesn't reduce to the DSL's shapes at all — a repeat body of 3+ steps, a nested repeat inside a repeat, or intensities that don't match the `[interval, rest]` pattern.

1. Read `messages.workoutStepMesgs` ordered by `messageIndex` (don't trust array order alone).
2. A step whose `durationType` starts with `repeatUntil…` is a loop marker, not a real step: its body is every step with `messageIndex` in `[durationValue, marker.messageIndex − 1]`, its reps is `targetValue`.
3. Body of exactly 1 step, `intensity: interval` → `IntervalSegment`, no rest. Body of exactly 2 steps, `[interval, rest]` → `IntervalSegment` with rest.
4. **Anything else** — 3+ steps, mismatched intensities, a nested marker — doesn't force-fit. It falls back to a new segment kind, below.
5. A standalone step outside any body, with a speed target → `ContinuousSegment`; `intensity: rest` alone → `RestBlockSegment`; no usable target at all → the DSL's existing `UnknownTarget`/`UnknownIntensity`, no new type needed there.

> **Reuse, don't invent.**
>
> The DSL already has a graceful-degradation vocabulary: `{kind:"unknown", raw}` for an unparseable token, and the `OTHER` day-type fallback (HRA-156) that preserves original text in `notes` rather than discarding it. A non-standard Garmin block should extend that same convention — a `RawGarminBlockSegment` that keeps the original steps verbatim (so re-export doesn't destroy what the user actually has on their watch), renders as an opaque block in the DSL editor, and sets `needs_review: true` with a `ParseWarning` explaining why it couldn't be simplified. This is new data, but not a new *pattern* — the accordion review UI already knows how to surface exactly this shape of problem.

### 4.4 Pace progressions have no Garmin equivalent

A FIT step target is one fixed low/high band for the step's whole duration. It cannot ramp. A `ProgressionSegment` (`start_intensity -> end_intensity` over one continuous target) has no faithful representation — this is a genuine one-way capability gap, not a rounding-precision issue.

| Strategy | Tradeoff |
|---|---|
| **Single wide band spanning both ends (recommended)** | One step, band = min(start,end) to max(start,end). Loses the ramp shape but the watch alerts correctly bound the whole effort. Emit a `GarminExportWarning`. |
| **Decompose into N discrete sub-steps** | Approximates a ramp as a staircase. More faithful, but multiplies step count and none of the sub-steps round-trip back to a single `ProgressionSegment` on re-import — they'd land as an unrecognized multi-step body (§4.3). |
| **Refuse to export, warn only** | Most honest, worst UX — a plan with any progression day simply can't reach the watch. |

### 4.5 Symbolic anchors cannot survive a round trip

Import can only ever produce an *absolute* intensity (a concrete pace) — FIT carries no metadata linking a target back to a named anchor like `RG` or `FL`. "Reconstruct our DSL string" from an imported file is achievable (`3x3000m @ 4:16/km` is valid DSL), but it can never recover `3x3000m @ RG-20` unless that link is preserved somewhere Garmin will carry it through untouched.

One low-cost enhancement, optional: FIT's per-step `name` field is free text a Garmin device displays but otherwise ignores. Exporting could smuggle the anchor expression into it (e.g. `"RG-20"`) purely as a hint our own importer looks for — and must work perfectly well without it, since a file from Garmin Connect, a coach, or any other producer will never have it. Round-trips through this app get their anchors back; round-trips through anyone else's tooling degrade gracefully to an absolute pace, which is already correct DSL.

---

## 5. Interfaces & pipeline

Split the same way `fit-parser.ts` (domain, pure) and `strava.ts`/`withings.ts` (integrations, vendor I/O) already split in this repo: transform logic that's unit-testable with no FIT bytes in play, and a thin wrapper that's the only file touching `@garmin/fitsdk` directly.

### 5.1 `garmin-stats/src/domain/garmin-workout/types.ts` — pure, no I/O

```ts
export interface GarminStep {
  messageIndex: number;
  // WktStepDuration enum value — verify exact literal against Profile.js
  durationType: "time" | "distance" | "repeatUntilStepsCmplt" | "open" | string;
  durationValue: number | null;   // ms, cm, or a back-reference messageIndex — meaning depends on durationType
  targetType: "speed" | "open" | string;
  targetValueLow: number | null;  // unscaled to real units by the adapter, never raw wire ints
  targetValueHigh: number | null;
  targetValueCount: number | null; // repeat count — only meaningful on a repeat-marker step
  intensity: "active" | "interval" | "rest" | "warmup" | "cooldown" | "other";
  name?: string;
}

// The DSL's existing WorkoutSegment union, plus one graceful-degradation case (§4.3)
export interface RawGarminBlockSegment {
  type: "raw_garmin_block";
  steps: GarminStep[];
  raw: string;  // human-readable summary for display — not re-parsed
}
export type ImportableSegment = WorkoutSegment | RawGarminBlockSegment;

export interface GarminExportWarning { stepIndex: number | null; message: string }
export interface GarminExportResult  { steps: GarminStep[]; warnings: GarminExportWarning[] }

export interface GarminImportResult {
  day: Omit<ResolvedDay, "segments"> & { segments: ImportableSegment[] };
  warnings: ParseWarning[];  // same shape runplan/types.ts already defines
}

export interface PaceBandPolicy {
  // width of the low/high band around a single resolved pace — a product decision, §6
  bandFor(pace_sec_per_km: number, intensity: GarminStep["intensity"]): { low_sec_per_km: number; high_sec_per_km: number };
}
```

### 5.2 `garmin-stats/src/domain/garmin-workout/export.ts` + `import.ts` — pure transforms

```ts
export function resolvedDayToGarminSteps(
  day: ResolvedDay,
  band: PaceBandPolicy,
): GarminExportResult { /* walk day.segments, apply the §4.2 mapping table */ }

export function garminStepsToResolvedDay(
  steps: GarminStep[],
): GarminImportResult { /* walk-and-classify per the §4.3 algorithm */ }
```

### 5.3 `garmin-stats/src/integrations/garmin-workout.ts` — only file importing `@garmin/fitsdk`

```ts
import { Encoder, Decoder, Stream, Profile } from "@garmin/fitsdk";
import { resolvedDayToGarminSteps } from "../domain/garmin-workout/export.ts";
import { garminStepsToResolvedDay } from "../domain/garmin-workout/import.ts";

export function toGarminFit(day: ResolvedDay, band: PaceBandPolicy) {
  const { steps, warnings } = resolvedDayToGarminSteps(day, band);
  const encoder = new Encoder();

  encoder.writeMesg({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: "workout", manufacturer: "development", product: 1, timeCreated: new Date(),
  });
  encoder.writeMesg({
    mesgNum: Profile.MesgNum.WORKOUT,
    workoutName: day.activity_description ?? "Run", sport: "running", numValidSteps: steps.length,
  });
  for (const step of steps) {
    // unknown fields are dropped silently by the encoder, not errored —
    // round-trip-decode immediately after close() in tests to catch a typo'd field name
    encoder.writeMesg({ mesgNum: Profile.MesgNum.WORKOUT_STEP, ...step });
  }

  return { buffer: Buffer.from(encoder.close()), warnings };
}

export function fromGarminFit(buffer: Buffer) {
  const { messages, errors } = new Decoder(Stream.fromBuffer(buffer)).read();
  if (errors.length) throw new Error(`FIT decode reported ${errors.length} error(s)`);
  return garminStepsToResolvedDay(messages.workoutStepMesgs ?? []);
}
```

### 5.4 Export pipeline

```text
ResolvedDay (resolved paces)
    ↓
resolvedDayToGarminSteps()          [domain · pure]
    ↓
flat steps + repeat marker          [§4.2]
    ↓
Encoder.writeMesg() × N             [integrations]
    ↓
.fit Buffer
```

### 5.5 Import pipeline

```text
.fit Buffer
    ↓
Decoder.read()                       [integrations]
    ↓
walk + classify repeat bodies       [§4.3]
    ↓
garminStepsToResolvedDay()           [domain · pure]
    ↓
ResolvedDay + warnings[]
```

---

## 6. Open decisions — not made here

This document picks the architecture. It deliberately does not pick these — each needs an explicit owner before implementation starts.

### Product — Pace-band width policy

Garmin needs a low/high range per step; the DSL only ever stores one target pace. Fixed ±N sec/km, a percentage of pace, or a per-anchor setting are all defensible — none is implied by the DSL as it stands today.

### Product — Progression-ramp fallback

Which of the three strategies ships is a training-fidelity call, not an engineering default — a wide band changes what the runner's watch will actually alert on mid-ramp.

### Repository policy — `@garmin/fitsdk` as a new runtime dependency

The backend's default is zero runtime dependencies, with two narrow, deliberate exceptions already granted (`fit-file-parser` for cross-validation, `zod` for schema validation). This is a third — flag it and get explicit sign-off rather than adding it silently; it's the correct tool here precisely because hand-rolling Workout-message encoding the way `fit-parser.ts` hand-rolled Activity-message decoding is how this repo got the field-mismap bugs documented in `CLAUDE.md` in the first place.

### Engineering — A DSL stringifier doesn't exist yet

`parseDayEntry()` only goes text → object today. Reconstructing a DSL string from an imported `ResolvedDay` needs a new inverse function regardless of which option is chosen here — it isn't part of the adapter itself, but the adapter's import path depends on it existing.

### Engineering — Exact FIT profile field names and scale/offset values

Every `durationType`/`targetType` literal and every scale/offset used above is illustrative, drawn from general FIT-profile conventions. Confirm each against `@garmin/fitsdk`'s shipped `Profile.js` (or `Profile.xlsx` for anything the JS profile leaves ambiguous) before writing the real encoder — not from this document, and not from memory.

---

*holistic-runner-app · garmin-stats · architecture note, not a Jira Story — file under the target Epic before implementation begins.*
