/**
 * FlagIcon.tsx
 * Inline SVG flags for LanguagePicker.tsx (HRA-104 follow-up). Windows lacks
 * a system font with regional-indicator flag glyphs, so the 🇬🇧/🇮🇹 emoji
 * pair silently fell back to rendering as the literal letters "GB"/"IT" —
 * an actual icon sidesteps that rather than relying on font support.
 */
import type { ReactElement } from "react";
import type { Language } from "@/types/api";

const FLAGS: Record<Language, ReactElement> = {
  en: (
    <svg viewBox="0 0 60 36" width="20" height="12" role="img">
      <rect width="60" height="36" fill="#00247d" />
      <path d="M0 0 60 36M60 0 0 36" stroke="#fff" strokeWidth="7.2" />
      <path d="M0 0 60 36M60 0 0 36" stroke="#cf142b" strokeWidth="2.4" />
      <path d="M30 0V36M0 18H60" stroke="#fff" strokeWidth="12" />
      <path d="M30 0V36M0 18H60" stroke="#cf142b" strokeWidth="7.2" />
    </svg>
  ),
  it: (
    <svg viewBox="0 0 60 36" width="20" height="12" role="img">
      <rect width="20" height="36" fill="#009246" />
      <rect x="20" width="20" height="36" fill="#fff" />
      <rect x="40" width="20" height="36" fill="#ce2b37" />
    </svg>
  ),
  fr: (
    <svg viewBox="0 0 60 36" width="20" height="12" role="img">
      <rect width="20" height="36" fill="#0055a4" />
      <rect x="20" width="20" height="36" fill="#fff" />
      <rect x="40" width="20" height="36" fill="#ef4135" />
    </svg>
  ),
  de: (
    <svg viewBox="0 0 60 36" width="20" height="12" role="img">
      <rect width="60" height="12" fill="#000" />
      <rect y="12" width="60" height="12" fill="#dd0000" />
      <rect y="24" width="60" height="12" fill="#ffce00" />
    </svg>
  ),
  es: (
    <svg viewBox="0 0 60 36" width="20" height="12" role="img">
      <rect width="60" height="36" fill="#aa151b" />
      <rect y="9" width="60" height="18" fill="#f1bf00" />
    </svg>
  ),
  ja: (
    <svg viewBox="0 0 60 36" width="20" height="12" role="img">
      <rect width="60" height="36" fill="#fff" />
      <circle cx="30" cy="18" r="10.8" fill="#bc002d" />
    </svg>
  ),
};

export function FlagIcon({ code }: { code: Language }) {
  return (
    <span className="hra-flag-icon" aria-hidden="true">
      {FLAGS[code]}
    </span>
  );
}
