// ── RunPlan DSL v1 — parser ─────────────────────────────────────────────────
// parseRunPlanDSL(input): manual line-based parsing with regular expressions,
// no external parser-generator dependency (HRA-111). See docs/runplan-dsl.md.

import type {
  AbsolutePace, AnchorIntensity, DayEntry, DayParseContext, DisplayUnit, EventType,
  Intensity, IntervalSegment, OffsetPace, OffsetUnit, PacePolicy, ParseError, ParseWarning,
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

const CROSS_RE = /^CROSS\s+(\S+)\s+(.+)$/i;
const STRENGTH_RE = /^STRENGTH\s+(\S+)\s+(.+)$/i;

const INTERVAL_HEADER_RE = /^(\d+)\s*x\s*(\S+)\s*@\s*(\S+)/i;
const INTERVAL_RE = /^(\d+)\s*x\s*(\S+)\s*@\s*(\S+)\s+r:\s*(\S+)(?:\s*@\s*(\S+))?(?:\s+(stand|walk|jog))?$/i;
const PROGRESSION_RE = /^(\S+)\s+PROG\s+(\S+)\s*->\s*(\S+)$/i;
const REST_BLOCK_RE = /^REST\s+(\S+)(?:\s+(stand|walk|jog))?$/i;
const CONTINUOUS_RE = /^(\S+)\s*@\s*(\S+)$/;

const EVENT_VALUES: readonly EventType[] = ["5k", "10k", "half", "marathon", "ultra"];

// ── low-level token parsers ─────────────────────────────────────────────────

function parseTarget(token: string): Target | null {
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
  return null;
}

function parseIntensity(token: string, offsetUnit: OffsetUnit): Intensity | null {
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
  return null;
}

function parsePaceValue(token: string, offsetUnit: OffsetUnit): AbsolutePace | OffsetPace | null {
  const intensity = parseIntensity(token, offsetUnit);
  if (!intensity || intensity.kind === "anchor") return null;
  return intensity.kind === "absolute"
    ? { kind: "absolute", pace_sec_per_km: intensity.pace_sec_per_km }
    : { kind: "offset", anchor: intensity.anchor, offset_sec_per_km: intensity.offset_sec_per_km };
}

function splitNote(line: string): { main: string; note?: string } {
  const idx = line.indexOf("#");
  if (idx === -1) return { main: line.trim() };
  return { main: line.slice(0, idx).trim(), note: line.slice(idx + 1).trim() };
}

// ── workout segment parsers ─────────────────────────────────────────────────

function parseInterval(seg: string, offsetUnit: OffsetUnit): IntervalSegment | { error: string; suggestion?: string } {
  if (INTERVAL_HEADER_RE.test(seg) && !/\br:/i.test(seg)) {
    return {
      error: "Interval segment must include rest between repetitions.",
      suggestion: `Use syntax: ${seg} r:1km @ RG+10`,
    };
  }
  const m = INTERVAL_RE.exec(seg);
  if (!m) return { error: `Invalid interval syntax: ${seg}` };
  const workTarget = parseTarget(m[2]);
  const workIntensity = parseIntensity(m[3], offsetUnit);
  const restTarget = parseTarget(m[4]);
  if (!workTarget || !workIntensity || !restTarget) {
    return { error: `Invalid interval syntax (bad target/intensity): ${seg}` };
  }
  const restIntensity = m[5] ? parseIntensity(m[5], offsetUnit) ?? undefined : undefined;
  const rest: RestSpec = {
    target: restTarget,
    intensity: restIntensity,
    rest_type: m[6] as RestType | undefined,
    raw: seg.slice(seg.indexOf("r:")),
  };
  return {
    type: "interval",
    reps: parseInt(m[1], 10),
    work_target: workTarget,
    work_intensity: workIntensity,
    rest,
    raw: seg,
  };
}

function parseProgression(seg: string, offsetUnit: OffsetUnit): ProgressionSegment | { error: string } {
  const m = PROGRESSION_RE.exec(seg);
  if (!m) return { error: `Invalid progression syntax: ${seg}` };
  const target = parseTarget(m[1]);
  const start = parseIntensity(m[2], offsetUnit);
  const end = parseIntensity(m[3], offsetUnit);
  if (!target || !start || !end) return { error: `Invalid progression syntax (bad target/intensity): ${seg}` };
  return { type: "progression", target, start_intensity: start, end_intensity: end, raw: seg };
}

function parseRestBlock(seg: string): RestBlockSegment | { error: string } {
  const m = REST_BLOCK_RE.exec(seg);
  if (!m) return { error: `Invalid rest block syntax: ${seg}` };
  const target = parseTarget(m[1]);
  if (!target) return { error: `Invalid rest block target: ${seg}` };
  return { type: "rest_block", target, rest_type: m[2] as RestType | undefined, raw: seg };
}

function parseContinuous(seg: string, offsetUnit: OffsetUnit): WorkoutSegment | { error: string } {
  const m = CONTINUOUS_RE.exec(seg);
  if (!m) return { error: `Unrecognized workout segment syntax: ${seg}` };
  const target = parseTarget(m[1]);
  const intensity = parseIntensity(m[2], offsetUnit);
  if (!target) {
    return {
      error: `Target has no unit: ${m[1]}`,
    };
  }
  if (!intensity) return { error: `Invalid intensity: ${m[2]}` };
  return { type: "continuous", target, intensity, raw: seg };
}

function parseSegment(seg: string, offsetUnit: OffsetUnit): WorkoutSegment | { error: string; suggestion?: string } {
  if (INTERVAL_HEADER_RE.test(seg)) return parseInterval(seg, offsetUnit);
  if (/\bPROG\b/i.test(seg)) return parseProgression(seg, offsetUnit);
  if (/^REST\s+/i.test(seg)) return parseRestBlock(seg);
  return parseContinuous(seg, offsetUnit);
}

// ── day-level parsing (exported: usable standalone for a future edit-one-day
//    UI flow, and internally by parseRunPlanDSL — HRA-111 amendment 2) ──────

export function parseDayEntry(rawLine: string, ctx: DayParseContext): DayEntry {
  const { main, note } = splitNote(rawLine);
  const errors: ParseError[] = [];
  const m = DAY_RE.exec(main);

  if (!m) {
    return {
      day: 0, workout_type: "todo", segments: [], notes: note, needs_review: true,
      raw_dsl: rawLine, valid: false,
      errors: [{ line: 0, content: rawLine, message: `Unrecognized day entry syntax: ${main}` }],
    };
  }

  const day = parseInt(m[1], 10);
  const suffix = m[2];
  const category = m[3];
  const workoutText = m[4].trim();

  if (day < 1 || day > 7) {
    errors.push({ line: 0, content: rawLine, message: "Day number must be 1 through 7." });
  }

  const base = {
    day, suffix, category, notes: note, raw_dsl: rawLine,
  };

  if (workoutText === "REST") {
    return { ...base, workout_type: "rest", segments: [], needs_review: false, valid: errors.length === 0, errors };
  }
  if (workoutText === "TODO") {
    return { ...base, workout_type: "todo", segments: [], needs_review: true, valid: errors.length === 0, errors };
  }

  const cross = CROSS_RE.exec(workoutText);
  if (cross) {
    const target = parseTarget(cross[1]) ?? undefined;
    if (!target) errors.push({ line: 0, content: rawLine, message: `Invalid CROSS target: ${cross[1]}` });
    return {
      ...base, workout_type: "cross", segments: [], activity_target: target, activity_description: cross[2],
      needs_review: false, valid: errors.length === 0, errors,
    };
  }
  const strength = STRENGTH_RE.exec(workoutText);
  if (strength) {
    const target = parseTarget(strength[1]) ?? undefined;
    if (!target) errors.push({ line: 0, content: rawLine, message: `Invalid STRENGTH target: ${strength[1]}` });
    return {
      ...base, workout_type: "strength", segments: [], activity_target: target, activity_description: strength[2],
      needs_review: false, valid: errors.length === 0, errors,
    };
  }

  // Plain run — one or more ;-separated segments.
  const segments: WorkoutSegment[] = [];
  let needsReview = false;
  for (const raw of workoutText.split(";")) {
    const seg = raw.trim();
    if (!seg) continue;
    const result = parseSegment(seg, ctx.offset_unit);
    if ("error" in result) {
      errors.push({ line: 0, content: rawLine, message: result.error, suggestion: result.suggestion });
      continue;
    }
    segments.push(result);
  }

  // §5.7 — an intensity that references an anchor missing from the effective
  // pace policy doesn't fail parsing; it's a warning, and the day is flagged
  // needs_review (distinct from valid:false, which is reserved for hard
  // syntax errors like a missing interval rest).
  for (const seg of segments) {
    const intensities: Intensity[] =
      seg.type === "continuous" ? [seg.intensity]
      : seg.type === "interval" ? [seg.work_intensity, ...(seg.rest.intensity ? [seg.rest.intensity] : [])]
      : seg.type === "progression" ? [seg.start_intensity, seg.end_intensity]
      : [];
    for (const intensity of intensities) {
      if (intensity.kind === "absolute") continue;
      if (!resolveIntensityToPace(intensity, ctx.pacePolicy).ok) needsReview = true;
    }
  }

  return {
    ...base, workout_type: "run", segments,
    needs_review: needsReview, valid: errors.length === 0, errors,
  };
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
    metadata: {
      unit: "km", offset_unit: "s/km", default_rest: "jog", pace_policy: {},
    },
    sections: [],
    valid: true,
    errors: [],
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
      section.errors.push({ line: 0, content: section.name, message: `Circular pace reference in section "${section.name}": ${anchor}` });
    }
    section.valid = section.errors.length === 0 && section.weeks.every(w => w.valid);
  }
  function closeWeek(week: Week | undefined) {
    if (!week) return;
    for (const anchor of detectCircularPaceRefs(week.pace_policy)) {
      week.errors.push({ line: 0, content: `WEEK ${week.number}`, message: `Circular pace reference in week ${week.number}: ${anchor}` });
    }
    week.valid = week.errors.length === 0 && week.days.every(d => d.valid);
  }

  function ensureDefaultSection() {
    if (!currentSection) {
      currentSection = { name: "Plan", week_spec: "*", pace_policy: {}, weeks: [], valid: true, errors: [] };
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
      currentSection = { name, week_spec: sectionMatch[3], notes: note, pace_policy: {}, weeks: [], valid: true, errors: [] };
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
        pace_policy: {}, days: [], valid: true, errors: [],
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
        plan.errors.push({ line: n, content: text, message: "DAY entry appears outside any WEEK." });
        continue;
      }
      const ctx: DayParseContext = {
        unit: plan.metadata.unit, offset_unit: plan.metadata.offset_unit, default_rest: plan.metadata.default_rest,
        pacePolicy: getEffectivePacePolicy(plan, currentSection!, currentWeek),
      };
      const day = parseDayEntry(text, ctx);
      day.errors = day.errors.map(e => ({ ...e, line: n }));
      currentWeek.days.push(day);
      weekSawDay = true;
      if (day.needs_review) {
        warnings.push({ line: n, content: text, message: "One or more pace anchors on this day could not be resolved." });
      }
      continue;
    }

    // PACE (scoped — plan/section/week, per HRA-108 §18)
    const paceMatch = PACE_LINE_RE.exec(main);
    if (paceMatch) {
      const anchor = paceMatch[1];
      const value = parsePaceValue(paceMatch[2], plan.metadata.offset_unit);
      if (!value) {
        plan.errors.push({ line: n, content: text, message: `Invalid PACE value: ${paceMatch[2]}` });
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
        if (target && target.kind === "distance") plan.metadata.distance_m = target.distance_m;
        else plan.errors.push({ line: n, content: text, message: `Invalid DISTANCE value: ${m[1]}` });
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

    plan.errors.push({ line: n, content: text, message: `Unrecognized line: ${main}` });
  }

  closeWeek(currentWeek);
  closeSection(currentSection);
  for (const anchor of detectCircularPaceRefs(plan.metadata.pace_policy)) {
    plan.errors.push({ line: 0, content: "PLAN", message: `Circular pace reference at plan level: ${anchor}` });
  }

  plan.valid = plan.errors.length === 0 && plan.sections.every(s => s.valid);

  // Zod validation of the final shape (HRA-108 §20) — a schema mismatch here
  // means a parser bug (the shape parseRunPlanDSL builds should always match
  // schema.ts), so it's surfaced as a plan-level error rather than thrown.
  const zodResult = runPlanSchema.safeParse(plan);
  if (!zodResult.success) {
    for (const issue of zodResult.error.issues) {
      plan.errors.push({ line: 0, content: issue.path.join("."), message: issue.message });
    }
    plan.valid = false;
  }

  return { ok: true, plan, warnings };
}
