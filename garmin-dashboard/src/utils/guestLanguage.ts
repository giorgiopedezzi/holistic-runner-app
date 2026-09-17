import { LANGUAGE_NAMES, type Language } from "@/types/api";

// Guest language is a browser-local preference (HRA-379), never a Settings
// row — Guest deliberately never fetches/writes GET|PUT /api/v1/settings
// (HRA-374's ADR: "Guest uses public product defaults"). localStorage is the
// reasonable choice here despite this app's general "no localStorage"
// default (frontend rules) — an anonymous Guest's choice has nowhere else to
// live and should survive a refresh/reopen, the same reasoning App.tsx's
// SIDEBAR_COLLAPSED_KEY already documents for its own local-only preference.
const GUEST_LANGUAGE_KEY = "hra-guest-language-v1";

// Validates against the existing supported-language list rather than trusting
// whatever string localStorage happens to hold (a stale value from a since-
// retired language, or hand-edited storage). An invalid value is removed
// opportunistically so it doesn't keep failing validation on every read.
export function readGuestLanguage(): Language | null {
  try {
    const stored = localStorage.getItem(GUEST_LANGUAGE_KEY);
    if (stored == null) return null;
    if ((LANGUAGE_NAMES as string[]).includes(stored)) return stored as Language;
    localStorage.removeItem(GUEST_LANGUAGE_KEY);
    return null;
  } catch {
    // Storage unavailable (privacy/security restrictions) — behave as if no
    // Guest preference exists; caller falls back to browser-locale detection.
    return null;
  }
}

export function writeGuestLanguage(language: Language): void {
  try {
    localStorage.setItem(GUEST_LANGUAGE_KEY, language);
  } catch {
    // Storage unavailable — the requested language still applies to i18next
    // for the current running app (caller's responsibility); it just won't
    // survive a reload.
  }
}
