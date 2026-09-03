// ── RunPlan DSL v1 — content-anchored dsl_source patching (HRA-117) ────────
// Pure logic, no I/O. When a user edits a Section's name/note, a Week's
// note, or a Day's dsl/note in the shared accordion (HRA-116), the template
// card must patch ONLY that exact touched line inside the full `dsl_source`
// string — never regenerate the whole document from the parsed tree (which
// would also normalize away the author's original formatting/comments
// everywhere else). Each patch function takes the node's own current known
// raw line (its `raw_dsl`, or whatever the previous patch produced) and
// returns the new line text; `replaceSpan` does the actual content-anchored
// substitution, refusing to guess when the old text isn't found exactly once.

// WEEKS clause is optional (mirrors garmin-stats/src/domain/runplan/
// parser.ts's own SECTION_RE) — a bare `SECTION "<name>"` is valid too.
const SECTION_RE = /^SECTION\s+(?:"([^"]+)"|(\S+))(?:\s+WEEKS\s+(\S+))?$/i;
const WEEK_RE = /^WEEK\s+(\d+)(?:\s+START\s+(\d{4}-\d{2}-\d{2}))?$/i;

export function splitNote(line: string): { main: string; note?: string } {
  const idx = line.indexOf("#");
  if (idx === -1) return { main: line.trim() };
  return { main: line.slice(0, idx).trim(), note: line.slice(idx + 1).trim() };
}

// Rebuilds a SECTION header line, preserving the original WEEKS spec exactly
// (never editable in this Story — only name/note are), or defaulting to "*"
// when the original line omitted the WEEKS clause entirely. Always re-emits
// the name quoted, even if the original used the grammar's bare-token
// alternative — a deliberate, benign normalization: still valid per the
// backend's own SECTION_RE, and safer once a name might later gain a space.
export function serializeSectionHeader(currentRawDsl: string, patch: { name?: string; notes?: string }): string {
  const { main, note } = splitNote(currentRawDsl);
  const m = SECTION_RE.exec(main);
  if (!m) throw new Error(`Cannot parse SECTION header to patch: ${currentRawDsl}`);
  const name = patch.name ?? (m[1] ?? m[2]);
  const weekSpec = m[3] ?? "*";
  const newNote = patch.notes !== undefined ? patch.notes : note;
  return `SECTION "${name}" WEEKS ${weekSpec}${newNote ? ` # ${newNote}` : ""}`;
}

// Rebuilds a WEEK header line, preserving its number and optional START date
// (neither editable in this Story — only the note is).
export function serializeWeekHeader(currentRawDsl: string, patch: { notes?: string }): string {
  const { main, note } = splitNote(currentRawDsl);
  const m = WEEK_RE.exec(main);
  if (!m) throw new Error(`Cannot parse WEEK header to patch: ${currentRawDsl}`);
  const [, number, startDate] = m;
  const newNote = patch.notes !== undefined ? patch.notes : note;
  return `WEEK ${number}${startDate ? ` START ${startDate}` : ""}${newNote ? ` # ${newNote}` : ""}`;
}

// A day's `dsl` (the accordion's editable text) and its separate `notes`
// field are two facets of the SAME line — DayEntry.raw_dsl already includes
// any trailing "# note" (parser.ts never strips it). Editing `dsl` replaces
// the whole line outright (whatever the user typed, including any note they
// embed themselves); editing `notes` alone re-composes onto the CURRENT
// line's own main clause, so the two fields never fight each other.
export function recomposeDayLine(currentFullLine: string, patch: { dsl?: string; notes?: string }): string {
  if (patch.dsl !== undefined) return patch.dsl;
  if (patch.notes !== undefined) {
    const { main } = splitNote(currentFullLine);
    return patch.notes ? `${main} # ${patch.notes}` : main;
  }
  return currentFullLine;
}

// D<n>[suffix][ [tag]]: — the whole D-line prefix up to and including the
// colon (mirrors garmin-stats/src/domain/runplan/parser.ts's DAY_RE, same
// grammar TrainingPlanAccordion.tsx's own display-only DAY_PREFIX_RE
// mirrors for a different purpose — both are small, independent copies of
// the same backend regex, same pattern SECTION_RE/WEEK_RE above already use).
const DAY_LINE_RE = /^(D\d+[a-c]?(?:\s*\[[^\]]+\])?\s*:\s*)(.*)$/;

// Exchanges two days' WORKOUT content (everything after the D<n>: prefix —
// the workout text and any trailing "# note") while each keeps its own
// D-number/suffix/tag prefix untouched (HRA-127) — a day's identity (which
// D-number, and therefore which calendar date once resolved) never moves,
// only what's scheduled on it. Malformed lines (prefix doesn't match the
// grammar) are returned unchanged rather than guessed at.
export function swapDayContent(dslA: string, dslB: string): [string, string] {
  const mA = DAY_LINE_RE.exec(dslA);
  const mB = DAY_LINE_RE.exec(dslB);
  if (!mA || !mB) return [dslA, dslB];
  return [`${mA[1]}${mB[2]}`, `${mB[1]}${mA[2]}`];
}

// HRA-234: patches ONE `;`-joined segment's text within a day's full line
// (prefix + workout body + optional "# note"), leaving every other
// segment's text and the note untouched — the structured field editors'
// own AC4 requirement ("editing one field on a multi-segment day does not
// alter the other segments' DSL text"). Malformed lines (prefix doesn't
// match the grammar, or segmentIndex is out of range) are returned
// unchanged, same "don't guess" convention as swapDayContent above.
export function replaceSegmentInDayLine(currentFullLine: string, segmentIndex: number, newSegmentText: string): string {
  const { main, note } = splitNote(currentFullLine);
  const m = DAY_LINE_RE.exec(main);
  if (!m) return currentFullLine;
  const prefix = m[1];
  const segments = m[2].split(";").map(s => s.trim());
  if (segmentIndex < 0 || segmentIndex >= segments.length) return currentFullLine;
  segments[segmentIndex] = newSegmentText;
  const newMain = `${prefix}${segments.join(" ; ")}`;
  return note ? `${newMain} # ${note}` : newMain;
}

export type ReplaceResult =
  | { ok: true; source: string }
  | { ok: false; reason: "not-found" | "ambiguous" };

// Content-anchored, single-occurrence replace — mirrors this repo's
// "no blind line-number mutation" editing discipline (CLAUDE.md) at the DSL
// level: refuses to guess when the old text isn't in the source exactly
// once, rather than silently patching the wrong occurrence or a stale span.
export function replaceSpan(source: string, oldText: string, newText: string): ReplaceResult {
  if (oldText === newText) return { ok: true, source };
  const first = source.indexOf(oldText);
  if (first === -1) return { ok: false, reason: "not-found" };
  const second = source.indexOf(oldText, first + oldText.length);
  if (second !== -1) return { ok: false, reason: "ambiguous" };
  return { ok: true, source: source.slice(0, first) + newText + source.slice(first + oldText.length) };
}

export interface Span { start: number; end: number }

// Training plans repeat the same lines a lot — the same rest day or easy-run
// line across weeks, or the same "WEEK 1" header re-used verbatim in a later
// section — so replaceSpan searching the WHOLE dsl_source flags a plainly
// legitimate edit as "ambiguous" the moment the touched line's text happens
// to recur outside the section/week actually being edited. findSectionSpan/
// findWeekSpan narrow the search to just the enclosing section/week's own
// slice of the document first, so a duplicate elsewhere in the plan never
// collides with the one actually being patched.
//
// Sections/weeks are walked in the same left-to-right order they already
// appear in the parsed tree, advancing a monotonic cursor after each one —
// so even if two headers share identical text, each is matched against its
// own occurrence in the document rather than always the first. Returns null
// (caller falls back to a whole-document replaceSpan) if a header's text
// can't be located at all — a genuinely stale/edited-elsewhere case that
// still needs the original "not-found" refusal.
export function findSectionSpan(dslSource: string, sections: { raw_dsl: string }[], sectionIndex: number): Span | null {
  let cursor = 0;
  let start = 0;
  for (let i = 0; i <= sectionIndex; i++) {
    const raw = sections[i].raw_dsl;
    if (raw === "") { start = 0; continue; } // implicit default section (HRA-115) — no header line to find
    const idx = dslSource.indexOf(raw, cursor);
    if (idx === -1) return null;
    if (i === sectionIndex) start = idx;
    cursor = idx + raw.length;
  }
  let end = dslSource.length;
  const next = sections[sectionIndex + 1];
  if (next && next.raw_dsl !== "") {
    const idx = dslSource.indexOf(next.raw_dsl, cursor);
    if (idx !== -1) end = idx;
  }
  return { start, end };
}

export function findWeekSpan(
  dslSource: string,
  sections: { raw_dsl: string; weeks: { raw_dsl: string }[] }[],
  sectionIndex: number,
  weekIndex: number,
): Span | null {
  const sectionSpan = findSectionSpan(dslSource, sections, sectionIndex);
  if (!sectionSpan) return null;
  const weeks = sections[sectionIndex].weeks;
  const slice = dslSource.slice(sectionSpan.start, sectionSpan.end);
  let cursor = 0;
  let start = 0;
  for (let i = 0; i <= weekIndex; i++) {
    const raw = weeks[i].raw_dsl;
    if (raw === "") return null; // instance week with no header text — nothing to anchor on
    const idx = slice.indexOf(raw, cursor);
    if (idx === -1) return null;
    if (i === weekIndex) start = idx;
    cursor = idx + raw.length;
  }
  let end = slice.length;
  const next = weeks[weekIndex + 1];
  if (next && next.raw_dsl !== "") {
    const idx = slice.indexOf(next.raw_dsl, cursor);
    if (idx !== -1) end = idx;
  }
  return { start: sectionSpan.start + start, end: sectionSpan.start + end };
}

// Same content-anchored, single-occurrence contract as replaceSpan, but
// scoped to `span` (from findSectionSpan/findWeekSpan) first — falls back to
// a whole-document replaceSpan when span is null, so callers get the exact
// prior behavior wherever the enclosing section/week couldn't be located.
export function replaceWithinSpan(fullSource: string, span: Span | null, oldText: string, newText: string): ReplaceResult {
  if (!span) return replaceSpan(fullSource, oldText, newText);
  const region = fullSource.slice(span.start, span.end);
  const result = replaceSpan(region, oldText, newText);
  if (!result.ok) return result;
  return { ok: true, source: fullSource.slice(0, span.start) + result.source + fullSource.slice(span.end) };
}
