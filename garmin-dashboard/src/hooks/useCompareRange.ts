import { useEffect, useState } from "react";
import { shiftIsoDate, daysBetween } from "@/utils/date";

export interface CompareRangeState {
  from:    string;
  to:      string;
  setFrom: (v: string) => void;
  setTo:   (v: string) => void;
}

// Default "compare to" window: same number of days as [from, to], ending
// the day before `from` starts. Exported standalone (not just used inside
// the hook below) so OverviewTab can compute the same default as a fallback
// for callers that don't pass compareFrom/compareTo explicitly (tests,
// mainly) — same numbers either way, one formula.
export function defaultCompareRange(from: string, to: string): { from: string; to: string } {
  const windowDays = daysBetween(from, to);
  const compareTo = shiftIsoDate(from, -1);
  const compareFrom = shiftIsoDate(compareTo, -(windowDays - 1));
  return { from: compareFrom, to: compareTo };
}

// Mirrors useDateRange's shape/pattern. Resets to the default window
// whenever the CURRENT range (from/to) changes — a deliberate choice (not
// "keep whatever was last picked"): the compare range is meant to track the
// current one by default, and re-picking a preset should give a clean,
// predictable comparison window again rather than silently carrying over a
// stale manual pick of a different length from a previous current range.
export function useCompareRange(from: string, to: string): CompareRangeState {
  const [range, setRange] = useState(() => defaultCompareRange(from, to));
  useEffect(() => setRange(defaultCompareRange(from, to)), [from, to]);

  return {
    from: range.from,
    to:   range.to,
    setFrom: (v: string) => setRange(r => ({ ...r, from: v })),
    setTo:   (v: string) => setRange(r => ({ ...r, to: v })),
  };
}
