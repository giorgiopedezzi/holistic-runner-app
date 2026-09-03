import { useEffect, useState } from "react";
import { DayPicker, type ChevronProps } from "react-day-picker";
import type { DayPickerLocale } from "react-day-picker/locale";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { loadCalendarLocale } from "@/utils/locale";

interface CalendarProps {
  selected?: Date;
  onSelect: (date: Date | undefined) => void;
  disabled?: (date: Date) => boolean;
  defaultMonth?: Date;
  // Bounds for the month/year dropdown navigation's own range, not the
  // day-level `disabled` predicate above (react-day-picker keeps these
  // separate: `startMonth`/`endMonth` only constrain which months/years the
  // dropdowns *offer*). Passed through from DatePicker's own min/max so, for
  // example, a date range's "from" picker doesn't offer decades nobody could
  // ever pick anyway.
  minDate?: Date;
  maxDate?: Date;
}

// "left"/"right" are the prev/next month nav buttons; "down" is the small
// caret inside each month/year dropdown's fake button (see index.css's
// .rdp-dropdown_root .rdp-caption_label) — smaller since it sits inline with
// text rather than standing alone in a 24px nav button.
function Chevron({ orientation }: ChevronProps) {
  if (orientation === "left") return <ChevronLeft size={14} />;
  if (orientation === "down") return <ChevronDown size={11} />;
  return <ChevronRight size={14} />;
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
export function Calendar({ selected, onSelect, disabled, defaultMonth, minDate, maxDate }: CalendarProps) {
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
      // Month/year dropdowns beside the arrow buttons (react-day-picker
      // v10's own captionLayout, not a hand-rolled nav) — lets a user jump
      // straight to e.g. "March 2019" instead of clicking prev/next dozens
      // of times through activity history. No explicit startMonth/endMonth
      // when neither min nor max is given: react-day-picker's own default
      // (100 years back to the end of this year) already comfortably covers
      // this app's data.
      captionLayout="dropdown"
      startMonth={minDate}
      endMonth={maxDate}
      // Puts the prev/next month buttons on either side of the month/year
      // dropdowns (react-day-picker's own layout, not a custom flex
      // rearrangement) instead of DayPicker's legacy default of a whole
      // separate nav row above the caption — react-day-picker's own docs
      // recommend "around" specifically for captionLayout="dropdown" so tab
      // order matches the visual order.
      navLayout="around"
    />
  );
}
