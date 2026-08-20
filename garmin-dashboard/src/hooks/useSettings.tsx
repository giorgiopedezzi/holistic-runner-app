import { createContext, use, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { Settings } from "@/types/api";

export interface SettingsContextValue {
  settings: Settings | null;
  loading:  boolean;
  error:    string | null;
  refetch:  () => void;
  // Lets a caller that already has the server's fresh Settings row (e.g.
  // after a PUT) push it into the shared store directly, instead of
  // triggering a second GET just to read back what it already has.
  update:   (updated: Settings) => void;
}

// The one place in the app that calls api.settings.get() (HRA-76) — shared
// by SettingsProvider (the real <App/> tree, `active` always true) and by
// useSettings()'s standalone fallback below (`active` only when there's no
// SettingsProvider ancestor at all). Most of this app's per-component Phase
// 0 tests mount a single settings-consuming component in isolation, with no
// <App/> tree above it — the fallback keeps them fetching for themselves
// exactly as they did before this Story, without a second literal call site.
function useSettingsFetch(active: boolean): SettingsContextValue {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading,  setLoading]  = useState(active);
  const [error,    setError]    = useState<string | null>(null);
  // Read via a ref, not a useCallback dependency — react-i18next's `t`
  // identity churns across renders more than expected here (observed:
  // putting it in fetchSettings' deps re-triggered the effect below in a
  // loop that hung a test). A ref sidesteps that entirely: fetchSettings
  // stays referentially stable (deps: [active] only), while still reading
  // whatever `t` most recently resolved to when the catch actually runs.
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  const fetchSettings = useCallback(() => {
    if (!active) return;
    setLoading(true);
    setError(null);
    api.settings.get()
      .then(setSettings)
      .catch(e => setError(e instanceof Error ? e.message : tRef.current("common.settingsLoadFailed", "Failed to load settings")))
      .finally(() => setLoading(false));
  }, [active]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const update = useCallback((updated: Settings) => setSettings(updated), []);

  return { settings, loading, error, refetch: fetchSettings, update };
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

// Mounted once around the whole app (App.tsx) — its single fetch is the
// "exactly one api.settings.get() call site" this Story requires in the
// real running app; every consumer below it shares this one fetch instead
// of running its own.
export function SettingsProvider({ children }: { children: ReactNode }) {
  const value = useSettingsFetch(true);
  return <SettingsContext value={value}>{children}</SettingsContext>;
}

export function useSettings(): SettingsContextValue {
  const ctx = use(SettingsContext);
  const standalone = useSettingsFetch(ctx == null);
  return ctx ?? standalone;
}
