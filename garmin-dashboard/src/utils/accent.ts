/**
 * utils/accent.ts  (HRA-95)
 * The curated selectable-accent palette. Each accent is one fixed hex,
 * identical across all 4 themes — same pattern as index.css's --data-*
 * tokens (a named constant, not a per-theme value) — since --accent governs
 * interactive chrome only, not anything that needs to match a theme's own
 * mood. onAccent is the text/icon color to use ON TOP of that accent fill
 * (buttons, active pills), pre-picked as whichever of pure black/white
 * clears WCAG AA (>=4.5:1) — computed once here, not derived at runtime.
 *
 * Contrast ratios (WCAG relative-luminance formula, verified per option —
 * see HRA-95's PR comment for the full derivation):
 *   teal    #0d9488 on #000000 → 5.61:1
 *   violet  #7c3aed on #ffffff → 5.70:1
 *   magenta #a21caf on #ffffff → 6.32:1
 *   amber   #b45309 on #ffffff → 5.02:1
 *   sky     #0284c7 on #000000 → 5.13:1
 *   lime    #65a30d on #000000 → 6.81:1
 * All six clear the 4.5:1 AA threshold; none is close enough to warrant a
 * safety margin note.
 */
import type { AccentColor } from "@/types/api";

export interface AccentDef {
  label: string;
  hex: string;
  onAccent: "#000000" | "#ffffff";
}

export const ACCENT_PALETTE: Record<AccentColor, AccentDef> = {
  teal:    { label: "Teal",    hex: "#0d9488", onAccent: "#000000" },
  violet:  { label: "Violet",  hex: "#7c3aed", onAccent: "#ffffff" },
  magenta: { label: "Magenta", hex: "#a21caf", onAccent: "#ffffff" },
  amber:   { label: "Amber",   hex: "#b45309", onAccent: "#ffffff" },
  sky:     { label: "Sky",     hex: "#0284c7", onAccent: "#000000" },
  lime:    { label: "Lime",    hex: "#65a30d", onAccent: "#000000" },
};
