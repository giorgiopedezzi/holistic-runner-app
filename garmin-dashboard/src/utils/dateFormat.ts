/**
 * utils/dateFormat.ts
 * Date-format preference state, read by utils/fmt.ts's fmtDate/fmtDateChart.
 * Same module-scope pattern as utils/units.ts (see that file's header comment
 * for why this app uses a plain module variable instead of React context) —
 * date_format only ever changes from the Settings tab, and every other tab
 * remounts fresh when switched to, so this is sufficient.
 */
import type { DateFormat } from "@/types/api";

let current: DateFormat = "literal_uk";

export function setDateFormatSystem(f: DateFormat): void {
  current = f;
}

export function getDateFormatSystem(): DateFormat {
  return current;
}

// Overview & Trends' chart axes always use a numeric date (never the spelled-
// out month a "literal" style setting would otherwise use — a compact axis
// tick has no room for "Aug"), but still respect the chosen region's
// day-month order. Derived from the full DateFormat rather than its own
// setting, so there's one source of truth for "uk or us."
export function dateFormatRegion(): "uk" | "us" {
  return current.endsWith("_us") ? "us" : "uk";
}
