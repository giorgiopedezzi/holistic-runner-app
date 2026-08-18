import { useEffect, useState } from "react";
import { DayPicker, type ChevronProps } from "react-day-picker";
import type { DayPickerLocale } from "react-day-picker/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { loadBrowserCalendarLocale } from "@/utils/locale";

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
// start day to the OS's own locale — react-day-picker defaults to English
// (enUS) otherwise, regardless of the OS's actual language/region. No
// `weekStartsOn` override: omitting it lets the locale's own convention
// (Monday almost everywhere outside en-US) decide, same as every other
// calendar app on the machine.
export function Calendar({ selected, onSelect, disabled, defaultMonth }: CalendarProps) {
  // undefined = react-day-picker's own default (enUS) — shown for the
  // instant before the OS locale's module resolves. loadBrowserCalendarLocale
  // is code-split and cached (one fetch total, shared by every Calendar
  // instance on the page), so in practice this resolves before a user could
  // ever notice — see utils/locale.ts.
  const [locale, setLocale] = useState<DayPickerLocale | undefined>(undefined);
  useEffect(() => { loadBrowserCalendarLocale().then(setLocale); }, []);

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
