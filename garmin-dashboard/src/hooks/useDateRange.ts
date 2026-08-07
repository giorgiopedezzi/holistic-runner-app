import { useState, useCallback } from "react";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

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
  const [from, setFrom] = useState(isoAgo(defaultDays));
  const [to,   setTo]   = useState(isoToday);

  const setPreset = useCallback((days: number) => {
    setFrom(days >= 9999 ? "2000-01-01" : isoAgo(days));
    setTo(isoToday());
  }, []);

  return { from, to, setFrom, setTo, setPreset };
}
