import { useCallback, useEffect, useRef } from "react";
import { api } from "@/api/client";
import type { Settings, Theme, StoredTheme, BackgroundKind, StoredUnitSystem, AccentColor } from "@/types/api";
import { BUNDLED_BACKGROUNDS } from "@/utils/backgrounds";
import { setUnitSystem, detectUnitSystemFromLocale, type ResolvedUnitSystem } from "@/utils/units";
import { ACCENT_PALETTE } from "@/utils/accent";
import { useSettings } from "@/hooks/useSettings";

// 'auto' resolves via the OS's prefers-color-scheme — the one appearance
// signal a web page genuinely can read directly (unlike measurement system,
// which has no equivalent API; see utils/units.ts's locale-based heuristic
// for that one).
function resolveTheme(stored: StoredTheme): Theme {
  if (stored !== "auto") return stored;
  const prefersDark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function resolveUnitSystem(stored: StoredUnitSystem): ResolvedUnitSystem {
  return stored === "auto" ? detectUnitSystemFromLocale() : stored;
}

// Applies theme + background + unit system straight to the document/module
// state — a data-theme attribute (matched by index.css's [data-theme="..."]
// blocks), the --bg-image custom property the page background reads, and
// utils/units.ts's module-level unit system. Called both on initial load and
// after every change, so everything always mirrors the persisted setting
// (this app has no localStorage, so there's no earlier client-side value to
// reconcile with — the backend is the only source of truth, 'auto' aside).
function applyToDocument(settings: Settings) {
  document.documentElement.setAttribute("data-theme", resolveTheme(settings.theme));

  let bgImage = "none";
  if (settings.background_kind === "bundled" && settings.background_value) {
    bgImage = BUNDLED_BACKGROUNDS[settings.background_value]?.css ?? "none";
  } else if (settings.background_kind === "custom" && settings.background_value) {
    bgImage = `url("${api.settings.backgroundImageUrl(settings.background_value)}")`;
  }
  document.documentElement.style.setProperty("--bg-image", bgImage);

  const accent = ACCENT_PALETTE[settings.accent_color];
  document.documentElement.style.setProperty("--accent", accent.hex);
  document.documentElement.style.setProperty("--on-accent", accent.onAccent);

  setUnitSystem(resolveUnitSystem(settings.unit_system));
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
  setTheme:         (theme: StoredTheme) => Promise<void>;
  setBackground:    (kind: BackgroundKind, value?: string) => Promise<void>;
  uploadBackground: (file: File) => Promise<void>;
  setUnits:         (unitSystem: StoredUnitSystem) => Promise<void>;
  // Optional (HRA-95), unlike the actions above — so the pre-existing,
  // hand-written AppearanceApi stub in SettingsTab.pickers.test.tsx keeps
  // structurally satisfying this interface unmodified. The real hook below
  // always provides it.
  setAccentColor?:  (accent: AccentColor) => Promise<void>;
}
export interface AppearanceMeta {
  resolvedTheme:       Theme | null;
  resolvedUnitSystem:  ResolvedUnitSystem | null;
}
export type AppearanceApi = AppearanceState & AppearanceActions & AppearanceMeta;

/**
 * useAppearance — reads the shared settings singleton (useSettings, HRA-76),
 * applies theme/background/units whenever it changes, and exposes setters
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
  // from the OS, but background/units still need to be whatever's current
  // when the OS scheme flips) — so it reads a ref instead of closing over
  // `settings` directly. That's what lets the effect depend on the single
  // primitive settings?.theme below instead of the whole settings object:
  // depending on the object would tear down and re-subscribe this listener
  // on every unrelated settings change (a background swap, a units change),
  // not just when theme itself starts/stops being 'auto' (HRA-78).
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

  const setTheme = useCallback(async (theme: StoredTheme) => {
    const updated = await api.settings.setTheme(theme);
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

  const setUnits = useCallback(async (unitSystem: StoredUnitSystem) => {
    const updated = await api.settings.setUnits(unitSystem);
    update(updated);
  }, [update]);

  const setAccentColor = useCallback(async (accent: AccentColor) => {
    const updated = await api.settings.setAccentColor(accent);
    update(updated);
  }, [update]);

  return {
    settings,
    setTheme,
    setBackground,
    uploadBackground,
    setUnits,
    setAccentColor,
    resolvedTheme: settings ? resolveTheme(settings.theme) : null,
    resolvedUnitSystem: settings ? resolveUnitSystem(settings.unit_system) : null,
  };
}
