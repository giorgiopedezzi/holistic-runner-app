// ── RunPlan DSL v1 — parser ─────────────────────────────────────────────────
// parseRunPlanDSL(input): manual line-based parsing with regular expressions,
// no external parser-generator dependency (HRA-111). See docs/runplan-dsl.md.
//
// HRA-113: nothing below ok:false (missing PLAN header / empty input) is a
// hard failure anymore. Anything the parser can't make sense of — a missing
// interval rest, an unrecognized token, a literal `?` placeholder — degrades
// to a ParseWarning instead, so messy/incomplete real-world input still
// produces a full plan tree to review and fix, never a rejection.

import type {
  AbsolutePace, AnchorIntensity, DayEntry, DayParseContext, DisplayUnit, EventType,
  Intensity, IntervalSegment, OffsetIntensity, OffsetPace, OffsetUnit, PacePolicy, ParseWarning,
  ProgressionSegment, RestBlockSegment, RestSpec, RestType, RunPlan, Section, Target, Week,
  WorkoutSegment,
} from "./types.ts";
import { getEffectivePacePolicy, resolveIntensityToPace, detectCircularPaceRefs } from "./pace.ts";
import { runPlanSchema } from "./schema.ts";

// ── unit conversion constants ───────────────────────────────────────────────
const M_PER_MILE = 1609.34;       // HRA-108 §10 — distance normalization
const KM_PER_MILE = 1.60934;      // HRA-108 §11.3/§13 — pace/offset normalization
const SEC_PER_MIN = 60;
const SEC_PER_HOUR = 3600;

// ── token-level regexes ─────────────────────────────────────────────────────
const DISTANCE_RE = /^(\d+(?:\.\d+)?)(m|km|mi)$/;
const DURATION_RE = /^(\d+(?:\.\d+)?)(s|sec|min|h)$/;
const APOSTROPHE_MIN_RE = /^(\d+(?:\.\d+)?)'$/;
const ABS_PACE_RE = /^(\d+):(\d{2})\/(km|mi)$/;
const OFFSET_RE = /^([A-Za-z0-9_]+)([+-])(\d+(?:\.\d+)?)(s\/km|s\/mi)?$/;
const ANCHOR_RE = /^[A-Za-z0-9_]+$/;

const PLAN_RE = /^PLAN$/;
const NAME_RE = /^NAME\s+(.+)$/;
const EVENT_RE = /^EVENT\s+(\S+)$/i;
const DISTANCE_META_RE = /^DISTANCE\s+(\S+)$/;
const GOAL_RE = /^GOAL\s+(\d{2}):(\d{2}):(\d{2})$/;
const START_RE = /^START\s+(\d{4}-\d{2}-\d{2})$/;
const UNIT_RE = /^UNIT\s+(km|mi)$/i;
const OFFSET_UNIT_RE = /^OFFSET_UNIT\s+(s\/km|s\/mi)$/i;
const DEFAULT_REST_RE = /^DEFAULT_REST\s+(stand|walk|jog)$/i;
const PACE_LINE_RE = /^PACE\s+(\S+)=(.+)$/;

const SECTION_RE = /^SECTION\s+(?:"([^"]+)"|(\S+))\s+WEEKS\s+(\S+)$/i;
const WEEK_RE = /^WEEK\s+(\d+)(?:\s+START\s+(\d{4}-\d{2}-\d{2}))?$/i;
const DAY_RE = /^D(\d+)([a-c])?(?:\s*\[([^\]]+)\])?\s*:\s*(.*)$/;

// HRA-113: target is optional — CROSS/STRENGTH validation is presence-only
// (naming the activity is enough). Captures everything after the keyword;
// splitOptionalTarget below decides whether the first token is a real target.
const CROSS_RE = /^CROSS\s+(.+)$/i;
const STRENGTH_RE = /^STRENGTH\s+(.+)$/i;

// HRA-113: reps may be `?` (unspecified); the `r:` rest clause is optional —
// a missing one is a warning (see parseInterval), not a match failure.
const INTERVAL_HEADER_RE = /^(\d+|\?)\s*x\s*(\S+)\s*@\s*(\S+)/i;
const INTERVAL_RE = /^(\d+|\?)\s*x\s*(\S+)\s*@\s*(\S+)(?:\s+r:\s*(\S+)(?:\s*@\s*(\S+))?(?:\s+(stand|walk|jog))?)?$/i;
const PROGRESSION_RE = /^(\S+)\s+PROG\s+(\S+)\s*->\s*(\S+)$/i;
const REST_BLOCK_RE = /^REST\s+(\S+)(?:\s+(stand|walk|jog))?$/i;
const CONTINUOUS_RE = /^(\S+)\s*@\s*(\S+)$/;

const EVENT_VALUES: readonly EventType[] = ["5k", "10k", "half", "marathon", "ultra"];

// ── low-level token parsers ─────────────────────────────────────────────────
// Never fail (HRA-113) — anything unrecognized falls back to kind:"unknown",
// carrying the raw text forward so the caller can warn with real context.

function parseTarget(token: string): Target {
  let m = DISTANCE_RE.exec(token);
  if (m) {
    const n = parseFloat(m[1]);
    const unit = m[2];
    const distance_m = unit === "m" ? n : unit === "km" ? n * 1000 : n * M_PER_MILE;
    return { kind: "distance", distance_m, raw: token };
  }
  m = DURATION_RE.exec(token);
  if (m) {
    const n = parseFloat(m[1]);
    const unit = m[2];
    const duration_sec = unit === "s" || unit === "sec" ? n : unit === "min" ? n * SEC_PER_MIN : n * SEC_PER_HOUR;
    return { kind: "duration", duration_sec, raw: token };
  }
  m = APOSTROPHE_MIN_RE.exec(token);
  if (m) {
    return { kind: "duration", duration_sec: parseFloat(m[1]) * SEC_PER_MIN, raw: token };
  }
  return { kind: "unknown", raw: token };
}

function looksLikeTarget(token: string): boolean {
  return DISTANCE_RE.test(token) || DURATION_RE.test(token) || APOSTROPHE_MIN_RE.test(token);
}

function parseIntensity(token: string, offsetUnit: OffsetUnit): Intensity {
  let m = ABS_PACE_RE.exec(token);
  if (m) {
    const totalSec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const pace_sec_per_km = m[3] === "km" ? totalSec : totalSec / KM_PER_MILE;
    return { kind: "absolute", pace_sec_per_km, raw: token };
  }
  m = OFFSET_RE.exec(token);
  if (m) {
    const anchor = m[1];
    const sign = m[2] === "+" ? 1 : -1;
    const amount = parseFloat(m[3]);
    const unit = (m[4] as OffsetUnit | undefined) ?? offsetUnit;
    const offset_sec_per_km = unit === "s/km" ? sign * amount : (sign * amount) / KM_PER_MILE;
    return { kind: "offset", anchor, offset_sec_per_km, raw: token };
  }
  if (ANCHOR_RE.test(token)) {
    return { kind: "anchor", anchor: token, raw: token };
  }
  return { kind: "unknown", raw: token };
}

// Exported for HRA-112's plan-template instantiate endpoint — a pace-override
// value in a request body ("6:40/mi", "RG+10s/km") uses the exact same
// grammar as a PACE line's right-hand side. Unlike parseIntensity, this keeps
// its "can fail" contract (null) — pace_overrides is a REST request parameter,
// not DSL prose, so rejecting a genuinely invalid override at the API
// boundary is still correct (rest-api-standards, not the DSL leniency rule).
export function parsePaceValue(token: string, offsetUnit: OffsetUnit): AbsolutePace | OffsetPace | null {
  const intensity = parseIntensity(token, offsetUnit);
  if (intensity.kind === "anchor" || intensity.kind === "unknown") return null;
  return intensity.kind === "absolute"
    ? { kind: "absolute", pace_sec_per_km: intensity.pace_sec_per_km }
    : { kind: "offset", anchor: intensity.anchor, offset_sec_per_km: intensity.offset_sec_per_km };
}

function splitNote(line: string): { main: string; note?: string } {
  const idx = line.indexOf("#");
  if (idx === -1) return { main: line.trim() };
  return { main: line.slice(0, idx).trim(), note: line.slice(idx + 1).trim() };
}

// CROSS/STRENGTH target is optional (HRA-113): if the first word after the
// keyword looks like a real Target AND there's more text after it, treat it
// as target+description; otherwise the whole remainder is just the
// description (e.g. "CROSS core" — no target, "core" is the description).
function splitOptionalTarget(rest: string): { target?: Target; description: string } {
  const parts = rest.split(/\s+/);
  if (parts.length > 1 && looksLikeTarget(parts[0])) {
    return { target: parseTarget(parts[0]), description: parts.slice(1).join(" ") };
  }
  return { description: rest };
}

// ── workout segment parsers ─────────────────────────────────────────────────
// Each always returns a segment (never fails, HRA-113) plus any warning
// messages generated while building it — the caller (parseDayEntry) attaches
// line context and pushes them onto the day's warnings.

interface SegmentResult<T extends WorkoutSegment = WorkoutSegment> {
  segment: T;
  warnings: string[];
}

function parseInterval(seg: string, offsetUnit: OffsetUnit): SegmentResult<IntervalSegment> {
  const warnings: string[] = [];
  const m = INTERVAL_RE.exec(seg);
  if (!m) {
    warnings.push(`Invalid interval syntax: ${seg}`);
    return {
      segment: {
        type: "interval", reps: null,
        work_target: { kind: "unknown", raw: seg }, work_intensity: { kind: "unknown", raw: seg },
        raw: seg,
      },
      warnings,
    };
  }
  const reps = m[1] === "?" ? null : parseInt(m[1], 10);
  if (reps === null) warnings.push("Number of repetitions is unspecified.");
  const workTarget = parseTarget(m[2]);
  if (workTarget.kind === "unknown") warnings.push(`Work target is unspecified or unrecognized: ${m[2]}`);
  const workIntensity = parseIntensity(m[3], offsetUnit);
  if (workIntensity.kind === "unknown") warnings.push(`Work intensity is unspecified or unrecognized: ${m[3]}`);

  let rest: RestSpec | undefined;
  if (m[4]) {
    const restTarget = parseTarget(m[4]);
    if (restTarget.kind === "unknown") warnings.push(`Rest target is unspecified or unrecognized: ${m[4]}`);
    const restIntensity = m[5] ? parseIntensity(m[5], offsetUnit) : undefined;
    rest = {
      target: restTarget, intensity: restIntensity, rest_type: m[6] as RestType | undefined,
      raw: seg.slice(seg.indexOf("r:")),
    };
  } else {
    warnings.push("Interval segment has no rest specified between repetitions.");
  }

  return { segment: { type: "interval", reps, work_target: workTarget, work_intensity: workIntensity, rest, raw: seg }, warnings };
}

function parseProgression(seg: string, offsetUnit: OffsetUnit): SegmentResult<ProgressionSegment> {
  const warnings: string[] = [];
  const m = PROGRESSION_RE.exec(seg);
  if (!m) {
    warnings.push(`Invalid progression syntax: ${seg}`);
    return {
      segment: {
        type: "progression", target: { kind: "unknown", raw: seg },
        start_intensity: { kind: "unknown", raw: seg }, end_intensity: { kind: "unknown", raw: seg }, raw: seg,
      },
      warnings,
    };
  }
  const target = parseTarget(m[1]);
  if (target.kind === "unknown") warnings.push(`Progression target is unspecified or unrecognized: ${m[1]}`);
  const start = parseIntensity(m[2], offsetUnit);
  if (start.kind === "unknown") warnings.push(`Progression start intensity is unspecified or unrecognized: ${m[2]}`);
  const end = parseIntensity(m[3], offsetUnit);
  if (end.kind === "unknown") warnings.push(`Progression end intensity is unspecified or unrecognized: ${m[3]}`);
  return { segment: { type: "progression", target, start_intensity: start, end_intensity: end, raw: seg }, warnings };
}

function parseRestBlock(seg: string): SegmentResult<RestBlockSegment> {
  const warnings: string[] = [];
  const m = REST_BLOCK_RE.exec(seg);
  if (!m) {
    warnings.push(`Invalid rest block syntax: ${seg}`);
    return { segment: { type: "rest_block", target: { kind: "unknown", raw: seg }, raw: seg }, warnings };
  }
  const target = parseTarget(m[1]);
  if (target.kind === "unknown") warnings.push(`Rest block target is unspecified or unrecognized: ${m[1]}`);
  return { segment: { type: "rest_block", target, rest_type: m[2] as RestType | undefined, raw: seg }, warnings };
}

function parseContinuous(seg: string, offsetUnit: OffsetUnit): SegmentResult {
  const warnings: string[] = [];
  const m = CONTINUOUS_RE.exec(seg);
  if (!m) {
    warnings.push(`Unrecognized workout segment syntax: ${seg}`);
    return { segment: { type: "continuous", target: { kind: "unknown", raw: seg }, intensity: { kind: "unknown", raw: seg }, raw: seg }, warnings };
  }
  const target = parseTarget(m[1]);
  if (target.kind === "unknown") warnings.push(`Target is unspecified or has no unit: ${m[1]}`);
  const intensity = parseIntensity(m[2], offsetUnit);
  if (intensity.kind === "unknown") warnings.push(`Intensity is unspecified or unrecognized: ${m[2]}`);
  return { segment: { type: "continuous", target, intensity, raw: seg }, warnings };
}

function parseSegment(seg: string, offsetUnit: OffsetUnit): SegmentResult {
  if (INTERVAL_HEADER_RE.test(seg)) return parseInterval(seg, offsetUnit);
  if (/\bPROG\b/i.test(seg)) return parseProgression(seg, offsetUnit);
  if (/^REST\s+/i.test(seg)) return parseRestBlock(seg);
  return parseContinuous(seg, offsetUnit);
}

// ── day-level parsing (exported: usable standalone for a future edit-one-day
//    UI flow, and internally by parseRunPlanDSL — HRA-111 amendment 2) ──────

export function parseDayEntry(rawLine: string, ctx: DayParseContext): DayEntry {
  const { main, note } = splitNote(rawLine);
  const warnings: ParseWarning[] = [];
  const warn = (message: string) => warnings.push({ line: 0, content: rawLine, message });

  const m = DAY_RE.exec(main);
  if (!m) {
    warn(`Unrecognized day entry syntax: ${main}`);
    return { day: 0, workout_type: "todo", segments: [], notes: note, needs_review: true, raw_dsl: rawLine, warnings };
  }

  const day = parseInt(m[1], 10);
  const suffix = m[2];
  const category = m[3];
  const workoutText = m[4].trim();

  if (day < 1 || day > 7) warn("Day number should be 1 through 7.");

  const base = { day, suffix, category, notes: note, raw_dsl: rawLine };

  if (workoutText === "REST") {
    return { ...base, workout_type: "rest", segments: [], needs_review: warnings.length > 0, warnings };
  }
  if (workoutText === "TODO") {
    return { ...base, workout_type: "todo", segments: [], needs_review: true, warnings };
  }

  const cross = CROSS_RE.exec(workoutText);
  if (cross) {
    const { target, description } = splitOptionalTarget(cross[1]);
    return { ...base, workout_type: "cross", segments: [], activity_target: target, activity_description: description, needs_review: warnings.length > 0, warnings };
  }
  const strength = STRENGTH_RE.exec(workoutText);
  if (strength) {
    const { target, description } = splitOptionalTarget(strength[1]);
    return { ...base, workout_type: "strength", segments: [], activity_target: target, activity_description: description, needs_review: warnings.length > 0, warnings };
  }

  // Plain run — one or more ;-separated segments.
  const segments: WorkoutSegment[] = [];
  for (const raw of workoutText.split(";")) {
    const seg = raw.trim();
    if (!seg) continue;
    const { segment, warnings: segWarnings } = parseSegment(seg, ctx.offset_unit);
    segments.push(segment);
    for (const w of segWarnings) warn(w);
  }

  // An intensity that references an anchor missing from the effective pace
  // policy doesn't fail parsing (HRA-108 §5.7, still true under HRA-113) —
  // it's a warning. kind:"unknown" intensities already warned above, so skip
  // them here to avoid a duplicate message for the same token.
  for (const seg of segments) {
    const intensities: Intensity[] =
      seg.type === "continuous" ? [seg.intensity]
      : seg.type === "interval" ? [seg.work_intensity, ...(seg.rest?.intensity ? [seg.rest.intensity] : [])]
      : seg.type === "progression" ? [seg.start_intensity, seg.end_intensity]
      : [];
    for (const intensity of intensities) {
      if (intensity.kind === "absolute" || intensity.kind === "unknown") continue;
      if (!resolveIntensityToPace(intensity, ctx.pacePolicy).ok) {
        const anchor = (intensity as AnchorIntensity | OffsetIntensity).anchor;
        warn(`Pace anchor "${anchor}" could not be resolved against the effective pace policy.`);
      }
    }
  }

  return { ...base, workout_type: "run", segments, needs_review: warnings.length > 0, warnings };
}

// ── main entry point ─────────────────────────────────────────────────────

export function parseRunPlanDSL(input: string): import("./types.ts").ParseResult {
  const rawLines = input.split(/\r\n|\r|\n/);
  const lines: { n: number; text: string }[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    lines.push({ n: i + 1, text: trimmed });
  }

  if (lines.length === 0) {
    return { ok: false, errors: [{ line: 0, content: "", message: "Input is empty." }], warnings: [] };
  }
  if (!PLAN_RE.test(lines[0].text)) {
    return {
      ok: false,
      errors: [{ line: lines[0].n, content: lines[0].text, message: "The first non-empty line must be PLAN." }],
      warnings: [],
    };
  }

  const plan: RunPlan = {
    metadata: { unit: "km", offset_unit: "s/km", default_rest: "jog", pace_policy: {} },
    sections: [],
  };
  const warnings: ParseWarning[] = [];

  let metadataClosed = false;
  let scope: "plan" | "section" | "week" = "plan";
  let currentSection: Section | undefined;
  let currentWeek: Week | undefined;
  let weekSawDay = false;

  function activePolicy(): PacePolicy {
    if (scope === "week" && currentWeek) return currentWeek.pace_policy;
    if (scope === "section" && currentSection) return currentSection.pace_policy;
    return plan.metadata.pace_policy;
  }

  function closeSection(section: Section | undefined) {
    if (!section) return;
    for (const anchor of detectCircularPaceRefs(section.pace_policy)) {
      warnings.push({ line: 0, content: section.name, message: `Circular pace reference in section "${section.name}": ${anchor}` });
    }
  }
  function closeWeek(week: Week | undefined) {
    if (!week) return;
    for (const anchor of detectCircularPaceRefs(week.pace_policy)) {
      warnings.push({ line: 0, content: `WEEK ${week.number}`, message: `Circular pace reference in week ${week.number}: ${anchor}` });
    }
  }

  function ensureDefaultSection() {
    if (!currentSection) {
      // raw_dsl: "" — there is no real SECTION header line to replace, since
      // this section was never written in source (HRA-115).
      currentSection = { name: "Plan", week_spec: "*", pace_policy: {}, weeks: [], raw_dsl: "" };
      plan.sections.push(currentSection);
    }
  }

  for (let i = 1; i < lines.length; i++) {
    const { n, text } = lines[i];
    const { main, note } = splitNote(text);
    if (!main) continue;

    // SECTION
    const sectionMatch = SECTION_RE.exec(main);
    if (sectionMatch) {
      closeWeek(currentWeek);
      closeSection(currentSection);
      currentWeek = undefined;
      const name = sectionMatch[1] ?? sectionMatch[2];
      currentSection = { name, week_spec: sectionMatch[3], notes: note, pace_policy: {}, weeks: [], raw_dsl: text };
      plan.sections.push(currentSection);
      scope = "section";
      metadataClosed = true;
      continue;
    }

    // WEEK
    const weekMatch = WEEK_RE.exec(main);
    if (weekMatch) {
      closeWeek(currentWeek);
      ensureDefaultSection();
      currentWeek = {
        number: parseInt(weekMatch[1], 10), start_date: weekMatch[2], notes: note,
        pace_policy: {}, days: [], raw_dsl: text,
      };
      currentSection!.weeks.push(currentWeek);
      scope = "week";
      weekSawDay = false;
      metadataClosed = true;
      continue;
    }

    // DAY
    const dayHeaderMatch = DAY_RE.test(main);
    if (dayHeaderMatch) {
      metadataClosed = true;
      if (!currentWeek) {
        warnings.push({ line: n, content: text, message: "DAY entry appears outside any WEEK." });
        continue;
      }
      const ctx: DayParseContext = {
        unit: plan.metadata.unit, offset_unit: plan.metadata.offset_unit, default_rest: plan.metadata.default_rest,
        pacePolicy: getEffectivePacePolicy(plan, currentSection!, currentWeek),
      };
      const day = parseDayEntry(text, ctx);
      day.warnings = day.warnings.map(w => ({ ...w, line: n }));
      currentWeek.days.push(day);
      weekSawDay = true;
      continue;
    }

    // PACE (scoped — plan/section/week, per HRA-108 §18)
    const paceMatch = PACE_LINE_RE.exec(main);
    if (paceMatch) {
      const anchor = paceMatch[1];
      const value = parsePaceValue(paceMatch[2], plan.metadata.offset_unit);
      if (!value) {
        warnings.push({ line: n, content: text, message: `Invalid PACE value: ${paceMatch[2]}` });
        continue;
      }
      activePolicy()[anchor] = value;
      if (scope === "week" && weekSawDay) {
        warnings.push({ line: n, content: text, message: `PACE line appears after day entries in WEEK ${currentWeek!.number}. It will apply to the whole week.` });
      }
      metadataClosed = metadataClosed || scope !== "plan";
      continue;
    }

    // Metadata (only before the first SECTION/WEEK/DAY)
    if (!metadataClosed) {
      let m: RegExpExecArray | null;
      if ((m = NAME_RE.exec(main))) { plan.metadata.name = m[1]; continue; }
      if ((m = EVENT_RE.exec(main))) {
        const value = m[1].toLowerCase();
        if ((EVENT_VALUES as readonly string[]).includes(value)) {
          plan.metadata.event = value as EventType;
        } else {
          plan.metadata.event = "custom";
          warnings.push({ line: n, content: text, message: `Unknown event type "${m[1]}", stored as custom.` });
        }
        continue;
      }
      if ((m = DISTANCE_META_RE.exec(main))) {
        const target = parseTarget(m[1]);
        if (target.kind === "distance") plan.metadata.distance_m = target.distance_m;
        else warnings.push({ line: n, content: text, message: `Invalid DISTANCE value: ${m[1]}` });
        continue;
      }
      if ((m = GOAL_RE.exec(main))) {
        plan.metadata.goal_time_sec = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
        continue;
      }
      if ((m = START_RE.exec(main))) { plan.metadata.start_date = m[1]; continue; }
      if ((m = UNIT_RE.exec(main))) { plan.metadata.unit = m[1].toLowerCase() as DisplayUnit; continue; }
      if ((m = OFFSET_UNIT_RE.exec(main))) { plan.metadata.offset_unit = m[1].toLowerCase() as OffsetUnit; continue; }
      if ((m = DEFAULT_REST_RE.exec(main))) { plan.metadata.default_rest = m[1].toLowerCase() as RestType; continue; }
    }

    warnings.push({ line: n, content: text, message: `Unrecognized line: ${main}` });
  }

  closeWeek(currentWeek);
  closeSection(currentSection);
  for (const anchor of detectCircularPaceRefs(plan.metadata.pace_policy)) {
    warnings.push({ line: 0, content: "PLAN", message: `Circular pace reference at plan level: ${anchor}` });
  }

  // Zod validation of the final shape (HRA-108 §20) is now a pure internal
  // invariant check, not user-facing feedback (HRA-113: there's no more
  // errors/valid concept on RunPlan to append a mismatch into). A schema
  // mismatch here means parseRunPlanDSL built a shape that doesn't match
  // schema.ts — a parser bug, not something about the caller's DSL text — so
  // it throws rather than silently becoming "just another warning", which
  // would misrepresent an internal defect as a user-input problem.
  const zodResult = runPlanSchema.safeParse(plan);
  if (!zodResult.success) {
    throw new Error(`Internal error: parsed RunPlan failed schema validation: ${JSON.stringify(zodResult.error.issues)}`);
  }

  return { ok: true, plan, warnings };
}
