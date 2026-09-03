import { useCallback, useEffect, useRef } from "react";
import { api } from "@/api/client";
import type { Settings, Theme, StoredTheme, StoredUnitSystem, AccentColor, DateFormat, Language, StoredLanguage, Palette, StoredPalette, BackgroundKind } from "@/types/api";
import { setUnitSystem, detectUnitSystemFromLocale, type ResolvedUnitSystem } from "@/utils/units";
import { setResolvedTheme } from "@/utils/theme";
import { setDateFormatSystem } from "@/utils/dateFormat";
import { useSettings } from "@/hooks/useSettings";
import { BUNDLED_BACKGROUNDS } from "@/utils/backgrounds";
import i18next, { detectLanguageFromLocale } from "@/i18n";

// 'auto' resolves via the OS's prefers-color-scheme — the one appearance
// signal a web page genuinely can read directly (unlike measurement system,
// which has no equivalent API; see utils/units.ts's locale-based heuristic
// for that one).
function resolveTheme(stored: StoredTheme): Theme {
  const prefersDark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  // Falls back the same way 'auto' does for any value that isn't a current
  // concrete Theme — covers a settings row persisted under a since-retired
  // name (e.g. 'dark-blue'/'light-warm') so index.css's [data-theme="…"]
  // blocks never see an unmatched attribute value.
  if (stored === "dark" || stored === "light") return stored;
  return prefersDark ? "dark" : "light";
}

function resolveUnitSystem(stored: StoredUnitSystem): ResolvedUnitSystem {
  return stored === "auto" ? detectUnitSystemFromLocale() : stored;
}

function resolveLanguage(stored: StoredLanguage): Language {
  return stored === "auto" ? detectLanguageFromLocale() : stored;
}

// Same 'auto' pattern as resolveTheme/resolveLanguage above — a settings row
// that's never had a palette explicitly PUT resolves by the ALREADY-resolved
// theme: 'graphite' for dark, 'warm' for light (dashboard design-system
// rework: "make graphite the default dark look, warm the default light
// look"). Once a user picks any concrete palette it's explicit and always
// wins, exactly like theme's own 'auto'.
function resolvePalette(stored: StoredPalette, theme: Theme): Palette {
  if (stored === "metal" || stored === "warm" || stored === "graphite") return stored;
  return theme === "dark" ? "graphite" : "warm";
}

// Re-introduces a per-user background image (reverses part of the 2026-08-16
// correction pass, per explicit product feedback) — sets --bg-image (read by
// index.css's body::before, falling back to the automatic ambient gradient
// when unset) and a data-background attribute (switches off the gradient's
// own shimmer animation for a real bundled/custom picture, see index.css).
// "custom" wraps the streamed image URL in url(...); "bundled" uses the
// preset's own CSS gradient value directly; "none" (or an unrecognized
// bundled id) clears both so the default ambient glow shows through.
function applyBackground(settings: Settings) {
  const root = document.documentElement;
  if (settings.background_kind === "bundled" && settings.background_value) {
    const preset = BUNDLED_BACKGROUNDS[settings.background_value];
    if (preset) {
      root.style.setProperty("--bg-image", preset.css);
      root.setAttribute("data-background", "bundled");
      return;
    }
  }
  if (settings.background_kind === "custom" && settings.background_value) {
    root.style.setProperty("--bg-image", `url("${api.settings.backgroundImageUrl(settings.background_value)}")`);
    root.setAttribute("data-background", "custom");
    return;
  }
  root.style.removeProperty("--bg-image");
  root.removeAttribute("data-background");
}

// Applies theme + unit system straight to the document/module state — a
// data-theme attribute (matched by index.css's [data-theme="..."] blocks)
// and utils/units.ts's module-level unit system. Called both on initial
// load and after every change, so everything always mirrors the persisted
// setting (this app has no localStorage, so there's no earlier client-side
// value to reconcile with — the backend is the only source of truth, 'auto'
// aside).
function applyToDocument(settings: Settings) {
  const theme = resolveTheme(settings.theme);
  document.documentElement.setAttribute("data-theme", theme);
  setResolvedTheme(theme);
  // Dashboard design-system rework: palette, compounded with data-theme above
  // (see index.css's :root[data-theme="…"][data-palette="…"] blocks).
  // resolvePalette() resolves the 'auto' sentinel by the theme just resolved
  // above (defaults to 'auto' server-side) — see that function's own
  // comment.
  document.documentElement.setAttribute("data-palette", resolvePalette(settings.palette, theme));
  applyBackground(settings);

  // --accent/--on-accent are no longer set from JS — each
  // [data-theme][data-palette] block in index.css defines its own fixed
  // accent directly (spec: one exact hex per theme, not a user-overridable
  // choice). accent_color still exists on Settings (paired 1:1 with palette
  // server-side) but nothing here reads it any more.

  setUnitSystem(resolveUnitSystem(settings.unit_system));
  setDateFormatSystem(settings.date_format);
  // Cold load: i18next already initialized synchronously with a default
  // language (i18n.ts) before this settings row resolved — this call, fired
  // from the same effect as theme/units/date-format above, is what applies
  // the persisted choice once it does (HRA-104). changeLanguage() is a no-op
  // if already the target language.
  void i18next.changeLanguage(resolveLanguage(settings.language));
}

// Explicit contract (HRA-77) — state / actions / meta, composed by
// intersection rather than nested under .state/.actions/.meta keys, so the
// runtime shape stays flat: every existing consumer (and every existing
// hand-written test stub) reads appearance.settings / appearance.setTheme /
// appearance.resolvedTheme directly, unchanged. Components should depend on
// this interface, not on `ReturnType<typeof useAppearance>` — the shape is
// then nameable and can be hand-stubbed without a hook or a network call.
export interface AppearanceState {
  settings: Settings | null;
}
export interface AppearanceActions {
  // Theme, not StoredTheme — 'auto' is no longer a writable choice (removed
  // from ThemePicker); only an explicit dark/light pick can be persisted.
  setTheme:         (theme: Theme) => Promise<void>;
  setUnits:         (unitSystem: StoredUnitSystem) => Promise<void>;
  // Optional (HRA-95), unlike the actions above — so the pre-existing,
  // hand-written AppearanceApi stub in SettingsTab.pickers.test.tsx keeps
  // structurally satisfying this interface unmodified. The real hook below
  // always provides it.
  setAccentColor?:  (accent: AccentColor) => Promise<void>;
  // Optional for the same reason setAccentColor is — keeps the pre-existing
  // hand-written AppearanceApi stub (SettingsTab.pickers.test.tsx) valid
  // without modification.
  setDateFormat?:   (format: DateFormat) => Promise<void>;
  // Optional for the same reason setAccentColor/setDateFormat are — keeps
  // the pre-existing hand-written AppearanceApi stub (SettingsTab.pickers.
  // test.tsx) valid without modification. Takes a concrete Language, not
  // StoredLanguage — the header picker (HRA-104) only ever offers 'en'/'it',
  // never 'auto' as a selectable option.
  setLanguage?:     (language: Language) => Promise<void>;
  // Optional for the same reason setAccentColor/setDateFormat/setLanguage
  // are — keeps the pre-existing hand-written AppearanceApi stub
  // (SettingsTab.pickers.test.tsx) valid without modification.
  setPalette?:      (palette: Palette) => Promise<void>;
  // Optional for the same reason setAccentColor/setDateFormat/setLanguage/
  // setPalette are — keeps the pre-existing hand-written AppearanceApi stub
  // (SettingsTab.pickers.test.tsx) valid without modification. `value` is
  // the bundled preset id; omit it (or pass "none") to clear the background.
  setBackground?:   (kind: BackgroundKind, value?: string) => Promise<void>;
  // Optional for the same reason setBackground is. Separate from
  // setBackground since it POSTs raw file bytes, not a JSON body — see
  // api/client.ts's uploadBackground.
  uploadBackground?: (file: File) => Promise<void>;
}
export interface AppearanceMeta {
  resolvedTheme:       Theme | null;
  resolvedUnitSystem:  ResolvedUnitSystem | null;
  // Optional, unlike resolvedTheme/resolvedUnitSystem above — those predate
  // this convention; every field added since (setAccentColor, setDateFormat,
  // and this one) stays optional so the pre-existing hand-written
  // AppearanceApi stub (SettingsTab.pickers.test.tsx) keeps compiling
  // unmodified.
  resolvedLanguage?:   Language | null;
  // Optional for the same reason resolvedLanguage is — keeps the
  // pre-existing hand-written AppearanceApi stub (SettingsTab.pickers.
  // test.tsx) valid without modification. The 'auto' sentinel resolved to a
  // concrete Palette (see resolvePalette above) — PalettePicker/ThemePicker
  // read this rather than the raw (possibly-'auto') settings.palette, same
  // relationship resolvedTheme has with the raw settings.theme.
  resolvedPalette?:    Palette | null;
}
export type AppearanceApi = AppearanceState & AppearanceActions & AppearanceMeta;

/**
 * useAppearance — reads the shared settings singleton (useSettings, HRA-76),
 * applies theme/units whenever it changes, and exposes setters
 * that update the backend and the shared store together (immediate-apply,
 * unlike SettingsTab's explicit-save pattern for the outlier thresholds —
 * appearance changes are meant to feel instant when clicked). While theme is
 * 'auto', also listens live for OS theme changes and re-applies without
 * needing a page reload.
 */
export function useAppearance(): AppearanceApi {
  const { settings, update } = useSettings();

  useEffect(() => {
    if (settings) applyToDocument(settings);
  }, [settings]);

  // The handler must always apply the LATEST settings (theme is read live
  // from the OS, but units still need to be whatever's current when the OS
  // scheme flips) — so it reads a ref instead of closing over `settings`
  // directly. That's what lets the effect depend on the single primitive
  // settings?.theme below instead of the whole settings object: depending
  // on the object would tear down and re-subscribe this listener on every
  // unrelated settings change (a units change, an accent change), not just
  // when theme itself starts/stops being 'auto' (HRA-78).
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
    if (!settings || settings.theme !== "auto" || typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const handler = () => { if (settingsRef.current) applyToDocument(settingsRef.current); };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
    // Intentional: only theme (not the whole settings object) should
    // re-subscribe this listener; the handler reads settingsRef.current for
    // everything else, see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.theme]);

  const setTheme = useCallback(async (theme: Theme) => {
    const updated = await api.settings.setTheme(theme);
    update(updated);
  }, [update]);

  const setUnits = useCallback(async (unitSystem: StoredUnitSystem) => {
    const updated = await api.settings.setUnits(unitSystem);
    update(updated);
  }, [update]);

  const setAccentColor = useCallback(async (accent: AccentColor) => {
    const updated = await api.settings.setAccentColor(accent);
    update(updated);
  }, [update]);

  const setDateFormat = useCallback(async (format: DateFormat) => {
    const updated = await api.settings.setDateFormat(format);
    update(updated);
  }, [update]);

  // PUTs the setting, then applies it immediately — deliberately not left to
  // wait for the settings-changed effect above to round-trip back down, since
  // react-i18next has its own subscription-based reactivity and doesn't need
  // the tab-remount mechanism utils/units.ts relies on (HRA-104).
  const setLanguage = useCallback(async (language: Language) => {
    const updated = await api.settings.setLanguage(language);
    update(updated);
    void i18next.changeLanguage(language);
  }, [update]);

  const setPalette = useCallback(async (palette: Palette) => {
    const updated = await api.settings.setPalette(palette);
    update(updated);
  }, [update]);

  const setBackground = useCallback(async (kind: BackgroundKind, value?: string) => {
    const updated = await api.settings.setBackground(kind, value);
    update(updated);
  }, [update]);

  const uploadBackground = useCallback(async (file: File) => {
    const updated = await api.settings.uploadBackground(file);
    update(updated);
  }, [update]);

  return {
    settings,
    setTheme,
    setUnits,
    setAccentColor,
    setDateFormat,
    setLanguage,
    setPalette,
    setBackground,
    uploadBackground,
    resolvedTheme: settings ? resolveTheme(settings.theme) : null,
    resolvedUnitSystem: settings ? resolveUnitSystem(settings.unit_system) : null,
    resolvedLanguage: settings ? resolveLanguage(settings.language) : null,
    resolvedPalette: settings ? resolvePalette(settings.palette, resolveTheme(settings.theme)) : null,
  };
}
