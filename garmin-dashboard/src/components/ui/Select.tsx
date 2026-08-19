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
  triggerStyle?: CSSProperties;
}

// shadcn-style Select (HRA-98) on top of Radix — value/onValueChange mirror
// the native <select>'s value/onChange contract it replaces, so callers keep
// their own state and side effects (what fetch a change triggers) unchanged.
// :hover/[data-highlighted]/[data-state] pseudo-states need a real class
// (same reason ui.tsx's Card uses .card:hover — see index.css).
export function Select({ value, onValueChange, options, placeholder, triggerStyle }: SelectProps) {
  // The selected option's label, for the trigger's native `title` — lets a
  // truncated (ellipsized) trigger still show the full text on hover, same
  // as each open-list item below.
  const selectedLabel = options.find(o => o.value === value)?.label;
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger className="hra-select-trigger" style={{ minWidth: 0, ...triggerStyle }} title={selectedLabel}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
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
