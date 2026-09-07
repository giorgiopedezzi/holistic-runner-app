import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { CSSProperties } from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  triggerClassName?: string;
  triggerWidth?: CSSProperties["width"];
  triggerHeight?: CSSProperties["height"];
  // HRA-133: optional — Radix's own Root already supports this, just wasn't
  // forwarded yet (no caller needed it before the plan-instance screen's
  // template picker, which must actually lock once an instance exists, not
  // just look inert).
  disabled?: boolean;
  // HRA-280: optional explicit accessible name — without it, the trigger's
  // announced name is whatever `SelectPrimitive.Value` currently renders
  // (the placeholder, or the selected option's own label), which doesn't say
  // what the control IS for a screen-reader user once a value is selected.
  ariaLabel?: string;
}

// shadcn-style Select (HRA-98) on top of Radix — value/onValueChange mirror
// the native <select>'s value/onChange contract it replaces, so callers keep
// their own state and side effects (what fetch a change triggers) unchanged.
// :hover/[data-highlighted]/[data-state] pseudo-states need a real class
// (same reason ui.tsx's Card uses .card:hover — see index.css).
export function Select({ value, onValueChange, options, placeholder, triggerClassName, triggerWidth, triggerHeight, disabled, ariaLabel }: SelectProps) {
  // The selected option's label, for the trigger's native `title` — lets a
  // truncated (ellipsized) trigger still show the full text on hover, same
  // as each open-list item below.
  const selectedLabel = options.find(o => o.value === value)?.label;
  const triggerVars = triggerWidth != null || triggerHeight != null
    ? {
        "--select-trigger-width": typeof triggerWidth === "number" ? `${triggerWidth}px` : triggerWidth,
        "--select-trigger-height": typeof triggerHeight === "number" ? `${triggerHeight}px` : triggerHeight,
      } as CSSProperties
    : undefined;
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        className={["hra-select-trigger", triggerClassName].filter(Boolean).join(" ")}
        style={triggerVars}
        data-runtime-width={triggerWidth != null ? "true" : undefined}
        data-runtime-height={triggerHeight != null ? "true" : undefined}
        title={selectedLabel}
        aria-label={ariaLabel}
      >
        <span className="hra-select-value">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown size={12} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="hra-select-content" position="popper" sideOffset={4}>
          <SelectPrimitive.Viewport>
            {options.map(o => (
              <SelectPrimitive.Item key={o.value} value={o.value} className="hra-select-item" title={o.label}>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="hra-select-item-indicator">
                  <Check size={12} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
