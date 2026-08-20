import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "./Popover";
import { Calendar } from "./Calendar";
import { fmtDate } from "@/utils/fmt";

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

// shadcn Popover+Calendar date picker (HRA-98) — drop-in replacement for
// <input type="date" value min max onChange>, same value/onChange contract
// so every call site's own state and side effects are unchanged.
export function DatePicker({ value, onChange, min, max }: DatePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = parseIso(value);
  const minDate = parseIso(min);
  const maxDate = parseIso(max);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="hra-date-trigger">
        <CalendarIcon size={13} />
        {/* fmtDate (utils/fmt.ts) — the single locale-aware date formatter
            every displayed date in the app now goes through, not a local
            copy of this same Intl.DateTimeFormat call. */}
        {value ? fmtDate(value) : t("common.selectDate", "Select date")}
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
