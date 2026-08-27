import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import type { CSSProperties } from "react";

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  color?: string;   // accent shown when checked — defaults to the app accent
  size?: number;    // px
  className?: string;
}

// shadcn-style Checkbox (HRA-98) on top of Radix — same checked/onChange
// contract as the native <input type="checkbox"> it replaces app-wide, so
// every call site keeps its own surrounding <label> and copy unchanged.
export function Checkbox({ checked, onCheckedChange, disabled, color = "var(--accent)", size = 14, className }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={v => onCheckedChange(v === true)}
      disabled={disabled}
      className={["hra-checkbox", className].filter(Boolean).join(" ")}
      style={{
        "--checkbox-color": color,
        "--checkbox-size": `${size}px`,
      } as CSSProperties}
    >
      <CheckboxPrimitive.Indicator className="hra-checkbox-indicator">
        <Check size={Math.max(8, size - 4)} color="var(--bg)" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
