import { useState, useCallback } from "react";
import { isoToday, isoAgo, ALL_SENTINEL } from "@/utils/date";
import { useUrlState } from "@/hooks/useUrlState";

export interface DateRangeState {
  from:      string;
  to:        string;
  setFrom:   (v: string) => void;
  setTo:     (v: string) => void;
  setPreset: (days: number) => void;
}

// Opt-in URL persistence (HRA-196) — only the AppShell-level range passes
// this; ManageTab's two Withings/Strava ranges call useDateRange without it
// and stay local/ephemeral, out of this Story's scope. Pass a stable
// (module-scope) object — see App.tsx's RANGE_URL_KEYS — since a fresh
// object literal on every render would defeat referential-equality checks
// elsewhere.
export interface DateRangeUrlKeys {
  from: string;
  to:   string;
}

export const PRESETS = [
  { label: "7d",  days: 7   },
  { label: "30d", days: 30  },
  { label: "90d", days: 90  },
  { label: "1y",  days: 365 },
  { label: "All", days: 9999 },
] as const;

export function useDateRange(defaultDays = 30, urlKeys?: DateRangeUrlKeys): DateRangeState {
  // Lazy init (HRA-78) — `() => isoAgo(defaultDays)` runs isoAgo() only on
  // the first render; the un-lazy form here previously ran on every render
  // just to build and discard a Date, the same bug the `to` state below
  // already avoided by passing isoToday itself (not isoToday()).
  const [defaultFrom] = useState(() => isoAgo(defaultDays));
  const [defaultTo]   = useState(isoToday);

  const [localFrom, setLocalFrom] = useState(defaultFrom);
  const [localTo,   setLocalTo]   = useState(defaultTo);
  // Always called (rules-of-hooks) even when urlKeys is absent — the unused
  // branch is simply never read from or written to, so it never touches the
  // URL for callers that didn't opt in.
  const [urlFrom, setUrlFrom] = useUrlState(urlKeys?.from ?? "", defaultFrom);
  const [urlTo,   setUrlTo]   = useUrlState(urlKeys?.to   ?? "", defaultTo);

  const from    = urlKeys ? urlFrom    : localFrom;
  const to      = urlKeys ? urlTo      : localTo;
  const setFrom = urlKeys ? setUrlFrom : setLocalFrom;
  const setTo   = urlKeys ? setUrlTo   : setLocalTo;

  const setPreset = useCallback((days: number) => {
    setFrom(days >= 9999 ? ALL_SENTINEL : isoAgo(days));
    setTo(isoToday());
  }, [setFrom, setTo]);

  return { from, to, setFrom, setTo, setPreset };
}
