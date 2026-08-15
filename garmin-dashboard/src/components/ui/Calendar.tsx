import { DayPicker, type ChevronProps } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
export function Calendar({ selected, onSelect, disabled, defaultMonth }: CalendarProps) {
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
    />
  );
}
