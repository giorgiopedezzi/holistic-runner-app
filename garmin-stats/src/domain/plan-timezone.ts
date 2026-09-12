// ── Plan-instance schedule timezone ───────────────────────────────────────
// IANA timezone validation and the Original-baseline freeze predicate for
// plan_instances (HRA-332). Pure functions, no I/O — same "pure logic, no
// I/O" convention as the other domain/ modules.
//
// Freeze is deliberately NOT a stored boolean flipped by a midnight job: an
// instance's Original baseline is frozen exactly when "today", read in the
// instance's own schedule_timezone, has reached or passed its
// original_start_date. That's a pure function of the current wall-clock
// instant, so it's recomputed on every mutation attempt instead of being
// scheduled — an instance created with a past start_date is therefore
// already frozen on its very first read, with nothing needing to "notice".

// The documented migration/backfill fallback (AC5) for an instance whose
// owner has never configured settings.timezone — a fixed literal, never the
// migration-running process's own runtime/server timezone, so backfill is
// reproducible across hosts.
export const SCHEDULE_TIMEZONE_BACKFILL_FALLBACK = "UTC";

// Intl.DateTimeFormat throws a RangeError for a timeZone it doesn't
// recognize — the standard way to validate an IANA identifier without a
// bundled zone-name list.
export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// "Today" as a YYYY-MM-DD calendar date in `timeZone` — en-CA formats
// year/month/day in that exact order with '-' separators, so no manual
// field reassembly is needed.
export function localDateInTimeZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

// True once the local calendar day in `timeZone` has reached or passed
// `originalStartDate` (YYYY-MM-DD) — the instance's first local plan day.
// `now` is injectable for tests (DST transitions, boundary dates).
export function isOriginalFrozen(originalStartDate: string, timeZone: string, now: Date = new Date()): boolean {
  return localDateInTimeZone(now, timeZone) >= originalStartDate;
}
