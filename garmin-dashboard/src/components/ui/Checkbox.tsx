import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import type { CSSProperties } from "react";

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  color?: string;   // accent shown when checked — defaults to the app accent
  size?: number;    // px
  style?: CSSProperties;
}

// shadcn-style Checkbox (HRA-98) on top of Radix — same checked/onChange
// contract as the native <input type="checkbox"> it replaces app-wide, so
// every call site keeps its own surrounding <label> and copy unchanged.
export function Checkbox({ checked, onCheckedChange, disabled, color = "var(--accent)", size = 14, style }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={v => onCheckedChange(v === true)}
      disabled={disabled}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 4,
        border: `1px solid ${checked ? color : "var(--border-strong)"}`,
        background: checked ? color : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background 0.15s, border-color 0.15s",
        ...style,
      }}
    >
      <CheckboxPrimitive.Indicator style={{ display: "flex" }}>
        <Check size={Math.max(8, size - 4)} color="var(--bg)" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
