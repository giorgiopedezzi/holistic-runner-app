import { useEffect, useState } from "react";
import { DayPicker, type ChevronProps } from "react-day-picker";
import type { DayPickerLocale } from "react-day-picker/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { loadCalendarLocale } from "@/utils/locale";

interface CalendarProps {
  selected?: Date;
  onSelect: (date: Date | undefined) => void;
  disabled?: (date: Date) => boolean;
  defaultMonth?: Date;
}

function Chevron({ orientation }: ChevronProps) {
  return orientation === "left" ? <ChevronLeft size={14} /> : <ChevronRight size={14} />;
}

// shadcn-style Calendar (HRA-98) — react-day-picker v10 in single-select
// mode, dark-themed via .hra-calendar/.rdp-* rules in index.css (v10 ships
// no default CSS, unlike earlier majors, so styling lives entirely there).
// `locale` (utils/locale.ts) matches month/weekday names AND the week's
// start day to the app's selected language (LanguagePicker.tsx) — react-day-
// picker defaults to English (enUS) otherwise, and previously fell back to
// navigator.language/the OS locale, which meant the popup could show a
// language the user never chose in-app and never changed when they switched
// it. `i18n.language` comes from useTranslation() (not a one-off read) so
// switching the header language picker re-resolves this without a reload.
// No `weekStartsOn` override: omitting it lets the locale's own convention
// (Monday almost everywhere outside en-US) decide, same as every other
// calendar app on the machine.
export function Calendar({ selected, onSelect, disabled, defaultMonth }: CalendarProps) {
  const { i18n } = useTranslation();
  // undefined = react-day-picker's own default (enUS) — shown for the
  // instant before the language's locale module resolves. loadCalendarLocale
  // is code-split and cached per language (one fetch per language total,
  // shared by every Calendar instance on the page), so in practice this
  // resolves before a user could ever notice — see utils/locale.ts.
  const [locale, setLocale] = useState<DayPickerLocale | undefined>(undefined);
  useEffect(() => { loadCalendarLocale(i18n.language).then(setLocale); }, [i18n.language]);

  return (
    <DayPicker
      mode="single"
      selected={selected}
      onSelect={onSelect}
      disabled={disabled}
      defaultMonth={defaultMonth ?? selected}
      showOutsideDays
      className="hra-calendar"
      components={{ Chevron }}
      locale={locale}
    />
  );
}
