/**
 * utils/backgrounds.ts
 * Bundled background-picture presets — CSS gradients, not photo files (this
 * app has no image assets to ship and no way to source real photos here),
 * selectable alongside a real upload in the Settings tab's "Background"
 * section. Each preset's `css` value is used directly as the page's
 * `--bg-image` custom property.
 */

export interface BackgroundPreset {
  id: string;
  label: string;
  css: string;
}

export const BUNDLED_BACKGROUNDS: Record<string, BackgroundPreset> = {
  aurora: {
    id: "aurora",
    label: "Aurora",
    css: "radial-gradient(ellipse at top left, #1db87a33 0%, transparent 55%), radial-gradient(ellipse at bottom right, #3a8ef533 0%, transparent 55%)",
  },
  sunset: {
    id: "sunset",
    label: "Sunset",
    css: "radial-gradient(ellipse at top right, #f59e0b33 0%, transparent 55%), radial-gradient(ellipse at bottom left, #e24b4a2e 0%, transparent 55%)",
  },
  ocean: {
    id: "ocean",
    label: "Ocean",
    css: "radial-gradient(ellipse at top, #3a8ef52e 0%, transparent 60%), radial-gradient(ellipse at bottom, #1db87a24 0%, transparent 60%)",
  },
  midnight: {
    id: "midnight",
    label: "Midnight",
    css: "radial-gradient(ellipse at center, #4d1db830 0%, transparent 65%), radial-gradient(ellipse at bottom right, #3a8ef52e 0%, transparent 55%)",
  },
};

export const BUNDLED_BACKGROUND_ORDER = ["aurora", "sunset", "ocean", "midnight"];
