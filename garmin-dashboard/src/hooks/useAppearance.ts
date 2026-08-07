import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import type { Settings, Theme, StoredTheme, BackgroundKind, StoredUnitSystem } from "@/types/api";
import { BUNDLED_BACKGROUNDS } from "@/utils/backgrounds";
import { setUnitSystem, detectUnitSystemFromLocale, type ResolvedUnitSystem } from "@/utils/units";

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

  setUnitSystem(resolveUnitSystem(settings.unit_system));
}

/**
 * useAppearance — fetches the persisted theme/background/units once,
 * applies them, and exposes setters that update the backend and the
 * document together (immediate-apply, unlike SettingsTab's explicit-save
 * pattern for the outlier thresholds — appearance changes are meant to feel
 * instant when clicked). While theme is 'auto', also listens live for OS
 * theme changes and re-applies without needing a page reload.
 */
export function useAppearance() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    api.settings.get().then(s => { setSettings(s); applyToDocument(s); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!settings || settings.theme !== "auto" || typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyToDocument(settings);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings]);

  const setTheme = useCallback(async (theme: StoredTheme) => {
    const updated = await api.settings.setTheme(theme);
    setSettings(updated);
    applyToDocument(updated);
  }, []);

  const setBackground = useCallback(async (kind: BackgroundKind, value?: string) => {
    const updated = await api.settings.setBackground(kind, value);
    setSettings(updated);
    applyToDocument(updated);
  }, []);

  const uploadBackground = useCallback(async (file: File) => {
    const updated = await api.settings.uploadBackground(file);
    setSettings(updated);
    applyToDocument(updated);
  }, []);

  const setUnits = useCallback(async (unitSystem: StoredUnitSystem) => {
    const updated = await api.settings.setUnits(unitSystem);
    setSettings(updated);
    applyToDocument(updated);
  }, []);

  return {
    settings,
    setTheme,
    setBackground,
    uploadBackground,
    setUnits,
    resolvedTheme: settings ? resolveTheme(settings.theme) : null,
    resolvedUnitSystem: settings ? resolveUnitSystem(settings.unit_system) : null,
  };
}
