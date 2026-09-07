import { useEffect, useState } from "react";

/**
 * useIsPhone — "is this a phone-width viewport right now", for the handful of
 * places where the phone layout isn't a restyle of the desktop one but a
 * genuinely different composition (a different set of children), which CSS
 * alone can't express: SplashScreen drops its chart/card chrome entirely,
 * PlanInstanceCalendar swaps its month/week grid for a day-by-day list.
 *
 * Prefer a `@media (max-width: 767px)` block in index.css whenever the phone
 * layout is the same elements arranged differently — this hook exists for
 * "render something else", not "style it differently".
 *
 * The cutoff is the same <768px one App.tsx's ViewportTier calls `phone` and
 * every `@media (max-width: 767px)` block in index.css already uses, kept
 * here as one exported constant so a TSX branch can never drift from the CSS
 * that styles what it renders. App.tsx keeps its own resize-listener tier
 * state (it needs all three tiers, not just this boolean).
 */
export const PHONE_MAX_WIDTH_PX = 767;

const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH_PX}px)`;

function phoneMatches(): boolean {
  // jsdom (and any SSR-ish first pass) has no matchMedia — treat "can't ask"
  // as not-a-phone, so the richer desktop composition stays the default.
  return typeof matchMedia === "function" && matchMedia(PHONE_QUERY).matches;
}

export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(phoneMatches);

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(PHONE_QUERY);
    function sync() {
      setIsPhone(mq.matches);
    }
    // Re-read once on mount as well as on change: a resize/rotation between
    // the initializer above and this effect would otherwise be missed.
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return isPhone;
}
