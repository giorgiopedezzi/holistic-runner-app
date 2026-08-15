import type { CSSProperties } from "react";

// Gradient accent pill + soft glow for "active" chrome — feature/temp-ui
// de-flatten pass. One shared style object so every active-state pill in
// the app (nav tabs, date-range presets, trend group-mode, body-metric
// chart view toggle) picks up the same treatment instead of each screen
// hand-rolling its own `background: active ? ... : ...`. Inactive state is
// left to each call site (labels/opacity differ enough per screen that a
// shared "off" style would fight more inline overrides than it saves).
export function glowPillStyle(active: boolean): CSSProperties {
  if (!active) return {};
  return {
    background: `linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--accent-glow)))`,
    // Shorthand `border`, not `borderColor` — every call site sets its base
    // (inactive) border via the `border` shorthand too; mixing shorthand and
    // longhand for the same property across renders is a real React DEV
    // warning ("Removing a style property... can lead to styling bugs"),
    // not just noise, since React's style diffing can leave a stale value
    // behind when the two forms alternate across re-renders.
    border: "1px solid transparent",
    color: "var(--on-accent)",
    // One step stronger than the first pass (polish pass, GLOW section) —
    // wider spread + higher accent concentration, still capped well short
    // of a full-opacity ring so it stays tasteful on dense rows of pills.
    boxShadow: `0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent), 0 0 20px color-mix(in srgb, var(--accent) 50%, transparent)`,
  };
}
