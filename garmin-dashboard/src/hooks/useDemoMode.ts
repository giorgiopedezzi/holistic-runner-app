import { useSettings } from "./useSettings";

// HRA-220: the frontend's one source for whether demo-mode write gating is
// on — read from the backend's own Settings.demo_mode (computed from
// DEMO_MODE), never a separately hardcoded frontend flag. Defaults false
// while settings haven't loaded yet, same as every other Settings-derived
// read in this app.
export function useDemoMode(): boolean {
  const { settings } = useSettings();
  return settings?.demo_mode ?? false;
}
