interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

// A plain <button role="switch"> (index.css's .hra-switch) — same
// checked/onCheckedChange contract as ui/Checkbox.tsx, for a boolean
// preference that reads better as an on/off toggle than a checkbox (e.g.
// DateRangeBar's "Compare" enable/disable).
export function Switch({ checked, onCheckedChange, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className="hra-switch"
      data-checked={checked}
    >
      <span className="hra-switch-thumb" />
    </button>
  );
}
