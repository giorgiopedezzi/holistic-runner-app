import { useState, useCallback } from "react";
import { isoToday, isoAgo } from "@/utils/date";

export interface DateRangeState {
  from:      string;
  to:        string;
  setFrom:   (v: string) => void;
  setTo:     (v: string) => void;
  setPreset: (days: number) => void;
}

export const PRESETS = [
  { label: "7d",  days: 7   },
  { label: "30d", days: 30  },
  { label: "90d", days: 90  },
  { label: "1y",  days: 365 },
  { label: "All", days: 9999 },
] as const;

export function useDateRange(defaultDays = 30): DateRangeState {
  // Lazy init (HRA-78) — `() => isoAgo(defaultDays)` runs isoAgo() only on
  // the first render; the un-lazy form here previously ran on every render
  // just to build and discard a Date, the same bug the `to` state below
  // already avoided by passing isoToday itself (not isoToday()).
  const [from, setFrom] = useState(() => isoAgo(defaultDays));
  const [to,   setTo]   = useState(isoToday);

  const setPreset = useCallback((days: number) => {
    setFrom(days >= 9999 ? "2000-01-01" : isoAgo(days));
    setTo(isoToday());
  }, []);

  return { from, to, setFrom, setTo, setPreset };
}
