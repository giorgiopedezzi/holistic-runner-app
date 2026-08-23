/**
 * utils/theme.ts
 * Resolved theme ('dark'|'light'), read by components with their own
 * theme-dependent JS-side color lookups (types/api.ts's SPORT_COLOR) that
 * can't just use a CSS custom property (a JS-picked, non-CSS-driven value
 * like a Recharts series color needs the concrete string, not var(--x)).
 *
 * State lives in a module-level variable, not React context — same pattern
 * as utils/units.ts (see that file's own comment for the full reasoning):
 * theme only ever changes from the Settings tab, and every other tab is
 * conditionally rendered (mounted fresh each time it's switched to — see
 * App.tsx), so a tab always picks up the latest value the next time it's
 * viewed without needing React to propagate a change into an already-
 * mounted, unrelated tree.
 */
import type { Theme } from "@/types/api";

let current: Theme = "dark";

export function setResolvedTheme(t: Theme): void {
  current = t;
}

export function getResolvedTheme(): Theme {
  return current;
}
