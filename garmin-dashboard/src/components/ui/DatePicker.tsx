import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "./Popover";
import { Calendar } from "./Calendar";

interface DatePickerProps {
  value: string;   // "YYYY-MM-DD", same shape the <input type="date"> it replaces used
  onChange: (v: string) => void;
  min?: string;
  max?: string;
}

// Parses/formats local calendar dates only (no timezone shift) — matches
// the native date input's own "YYYY-MM-DD, no time component" semantics.
function parseIso(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Display only — `value`/onChange stay "YYYY-MM-DD" throughout (the API
// contract this component's callers/state all still use). No explicit
// locale argument: passing undefined to Intl.DateTimeFormat means "use the
// runtime's default locale," which in a browser is the OS/browser language
// setting — the same source native <input type="date"> itself reads its
// display format from, so this reads as "the same as everywhere else on
// the machine" rather than this app's own fixed ISO string.
const displayFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
function formatDisplay(v: string): string {
  const d = parseIso(v);
  return d ? displayFormat.format(d) : "";
}

// shadcn Popover+Calendar date picker (HRA-98) — drop-in replacement for
// <input type="date" value min max onChange>, same value/onChange contract
// so every call site's own state and side effects are unchanged.
export function DatePicker({ value, onChange, min, max }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = parseIso(value);
  const minDate = parseIso(min);
  const maxDate = parseIso(max);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="hra-date-trigger">
        <CalendarIcon size={13} />
        {value ? formatDisplay(value) : "Select date"}
      </PopoverTrigger>
      <PopoverContent>
        <Calendar
          selected={selected}
          defaultMonth={selected}
          onSelect={d => { if (d) { onChange(toIso(d)); setOpen(false); } }}
          disabled={d => (minDate ? d < minDate : false) || (maxDate ? d > maxDate : false)}
        />
      </PopoverContent>
    </Popover>
  );
}
