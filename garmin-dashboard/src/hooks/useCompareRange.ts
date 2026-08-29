import { useEffect, useRef, useState } from "react";
import { shiftIsoDate, daysBetween } from "@/utils/date";
import { useUrlState } from "@/hooks/useUrlState";

export interface CompareRangeState {
  from:    string;
  to:      string;
  setFrom: (v: string) => void;
  setTo:   (v: string) => void;
  // Whether "Compare to" is switched on at all (DateRangeBar's toggle beside
  // "Current"). Defaults true so existing behavior — comparison always on —
  // is unchanged until a user explicitly turns it off. Callers (OverviewTab)
  // gate every comparison fetch/render on this, not just from/to presence.
  enabled:    boolean;
  setEnabled: (v: boolean) => void;
}

// Opt-in URL persistence (HRA-196), mirroring useDateRange's DateRangeUrlKeys
// — pass a stable (module-scope) object, see App.tsx's COMPARE_URL_KEYS.
export interface CompareRangeUrlKeys {
  from:    string;
  to:      string;
  enabled: string;
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
export function useCompareRange(from: string, to: string, urlKeys?: CompareRangeUrlKeys): CompareRangeState {
  const [defaultRange] = useState(() => defaultCompareRange(from, to));

  const [localRange, setLocalRange] = useState(defaultRange);
  const [localEnabled, setLocalEnabled] = useState(true);
  // Always called (rules-of-hooks) even when urlKeys is absent — see
  // useDateRange's identical HRA-196 pattern.
  const [urlFrom, setUrlFrom] = useUrlState(urlKeys?.from ?? "", defaultRange.from);
  const [urlTo, setUrlTo] = useUrlState(urlKeys?.to ?? "", defaultRange.to);
  const [urlEnabledParam, setUrlEnabledParam] = useUrlState(urlKeys?.enabled ?? "", "1");

  const compFrom = urlKeys ? urlFrom : localRange.from;
  const compTo   = urlKeys ? urlTo   : localRange.to;
  const enabled  = urlKeys ? urlEnabledParam !== "0" : localEnabled;
  const setFrom   = urlKeys ? setUrlFrom : (v: string) => setLocalRange(r => ({ ...r, from: v }));
  const setTo     = urlKeys ? setUrlTo   : (v: string) => setLocalRange(r => ({ ...r, to: v }));
  const setEnabled = urlKeys
    ? (v: boolean) => setUrlEnabledParam(v ? "1" : "0")
    : setLocalEnabled;

  // Must not fire on initial mount — a boolean "isFirst" ref guard here would
  // be defeated by React 19 StrictMode's dev-only double-invoke of effects
  // (mount -> cleanup -> mount again, see ActivityDetailBody.tsx's identical
  // note and ActivitiesTab.tsx's matching fix): the ref's mutation from the
  // first synthetic invocation would survive into the second, which then
  // incorrectly reads as "not the first run" and fires for real — wiping a
  // compare range just hydrated from the URL on every dev-mode page load.
  // Comparing against the PREVIOUS actual from/to instead survives the
  // replay, since both synthetic invocations see identical values.
  const prevRangeRef = useRef<{ from: string; to: string } | null>(null);
  useEffect(() => {
    const prevRange = prevRangeRef.current;
    prevRangeRef.current = { from, to };
    if (!prevRange || (prevRange.from === from && prevRange.to === to)) return;
    const next = defaultCompareRange(from, to);
    if (urlKeys) {
      setUrlFrom(next.from);
      setUrlTo(next.to);
    } else {
      setLocalRange(next);
    }
    // urlKeys is a caller-stable module-scope object (never changes identity
    // per call site); including it would re-run this effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, setUrlFrom, setUrlTo]);

  return { from: compFrom, to: compTo, setFrom, setTo, enabled, setEnabled };
}
