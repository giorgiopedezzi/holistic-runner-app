import { useEffect, useRef, useState } from "react";
import { shiftIsoDate, daysBetween, ALL_SENTINEL } from "@/utils/date";
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

// All available data has no natural "previous period" to mirror — feeding
// the sentinel into defaultCompareRange() manufactures a multi-decade
// comparison window nobody asked for (HRA-256). Falls back to a trivial,
// inert placeholder; comparison itself starts/goes disabled whenever `from`
// is the sentinel (see useCompareRange below), so this value is never
// actually fetched until the user manually re-enables and picks a real
// range.
function safeDefaultCompareRange(from: string, to: string): { from: string; to: string } {
  return from === ALL_SENTINEL ? { from: to, to } : defaultCompareRange(from, to);
}

// Mirrors useDateRange's shape/pattern. Resets to the default window
// whenever the CURRENT range (from/to) changes — a deliberate choice (not
// "keep whatever was last picked"): the compare range is meant to track the
// current one by default, and re-picking a preset should give a clean,
// predictable comparison window again rather than silently carrying over a
// stale manual pick of a different length from a previous current range.
export function useCompareRange(from: string, to: string, urlKeys?: CompareRangeUrlKeys): CompareRangeState {
  const [defaultRange] = useState(() => safeDefaultCompareRange(from, to));

  const [localRange, setLocalRange] = useState(defaultRange);
  // Starts disabled when mounting straight into All (e.g. a shared/bookmarked
  // "All" URL) — mirrors the "selecting All disables comparison" rule below
  // instead of only applying it on a later transition.
  const [localEnabled, setLocalEnabled] = useState(from !== ALL_SENTINEL);
  // Always called (rules-of-hooks) even when urlKeys is absent — see
  // useDateRange's identical HRA-196 pattern.
  const [urlFrom, setUrlFrom] = useUrlState(urlKeys?.from ?? "", defaultRange.from);
  const [urlTo, setUrlTo] = useUrlState(urlKeys?.to ?? "", defaultRange.to);
  const [urlEnabledParam, setUrlEnabledParam] = useUrlState(urlKeys?.enabled ?? "", from === ALL_SENTINEL ? "0" : "1");

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
    if (from === ALL_SENTINEL) {
      // All is selected — never derive an automatic multi-decade "previous
      // period" off the sentinel (HRA-256). Only the actual transition INTO
      // All forces comparison off; a later edit to `to` alone (from stays
      // the sentinel) skips the auto-update without touching `enabled`, so a
      // comparison the user manually re-enables while All stays selected
      // survives it.
      if (prevRange.from !== ALL_SENTINEL) {
        if (urlKeys) setUrlEnabledParam("0"); else setLocalEnabled(false);
      }
      return;
    }
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
  }, [from, to, setUrlFrom, setUrlTo, setUrlEnabledParam]);

  return { from: compFrom, to: compTo, setFrom, setTo, enabled, setEnabled };
}
