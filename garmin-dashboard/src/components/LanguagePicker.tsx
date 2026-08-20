/**
 * LanguagePicker.tsx
 * Header nav bar's language dropdown (HRA-104) — not in SettingsTab, since
 * this is meant to feel like a global chrome control (same instinct as the
 * status dot), not a settings-tab preference. Closed state shows the current
 * language as flag + ISO code; open state lists both supported languages the
 * same way. Selecting one calls appearance.setLanguage(), which both PUTs the
 * setting and applies it immediately via i18next.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_NAMES, type Language } from "@/types/api";
import type { AppearanceApi } from "@/hooks/useAppearance";
import { detectLanguageFromLocale } from "@/i18n";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/Popover";

const LANGUAGE_META: Record<Language, { flag: string; label: string }> = {
  en: { flag: "🇬🇧", label: "EN" },
  it: { flag: "🇮🇹", label: "IT" },
};

export function LanguagePicker({ appearance }: { appearance: AppearanceApi }) {
  const { t } = useTranslation();
  // Falls back to the browser-detected default while settings haven't
  // resolved yet (appearance.resolvedLanguage is null on cold load) — same
  // detection i18n.ts uses for its own synchronous initial language.
  const current = appearance.resolvedLanguage ?? detectLanguageFromLocale();
  const meta = LANGUAGE_META[current];
  // Controlled open state (same pattern as DatePicker.tsx) so picking a
  // language closes the popover — a plain <button> item, unlike a Radix
  // Select item, doesn't dismiss it on its own.
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="hra-date-trigger" aria-label={t("common.changeLanguage", "Change language")}>
          <span aria-hidden="true">{meta.flag}</span>
          <span>{meta.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end">
        <div className="hra-lang-list">
          {LANGUAGE_NAMES.map(code => {
            const opt = LANGUAGE_META[code];
            const selected = current === code;
            return (
              <button
                key={code}
                className="hra-lang-item"
                data-selected={selected}
                onClick={() => { appearance.setLanguage?.(code); setOpen(false); }}
              >
                <span aria-hidden="true">{opt.flag}</span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
