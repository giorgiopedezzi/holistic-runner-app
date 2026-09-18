import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ACTUAL_RUNNING_CATEGORY_ICONS, ACTUAL_RUNNING_CATEGORY_ORDER } from "@/components/manage/categoryVisuals";
import { ACTUAL_RUNNING_CLASSIFICATION_KEY, type ActualRunningClassification } from "@/types/api";

interface ClassificationPickerProps {
  value: ActualRunningClassification | null;
  onValueChange: (value: ActualRunningClassification) => void;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}

// Compact icon-based dropdown (HRA-394) — shadcn/Radix Select, not a native
// <select>, replacing ClassificationCard's old native <select> + separate
// "Override classification" button. Its closed state always shows the
// current effective category's own icon+label (not just inside the open
// menu), and selecting an option is itself the persist action — the caller
// wires onValueChange straight to the override PUT, no separate confirm step.
export function ClassificationPicker({ value, onValueChange, disabled, title, ariaLabel }: ClassificationPickerProps) {
  const { t } = useTranslation();
  const label = (category: ActualRunningClassification) => {
    const [key, fallback] = ACTUAL_RUNNING_CLASSIFICATION_KEY[category];
    return t(key, fallback);
  };
  const CurrentIcon = value ? ACTUAL_RUNNING_CATEGORY_ICONS[value] : null;

  return (
    <SelectPrimitive.Root value={value ?? undefined} onValueChange={v => onValueChange(v as ActualRunningClassification)} disabled={disabled}>
      <SelectPrimitive.Trigger
        className="hra-select-trigger"
        aria-label={ariaLabel ?? t("activity.classify.overrideChoice", "Classification override")}
        title={title ?? (value ? label(value) : undefined)}
      >
        <span className="hra-select-value hra-row-inline">
          {value && CurrentIcon ? (
            <>
              <CurrentIcon size={14} />
              <span>{label(value)}</span>
            </>
          ) : (
            <SelectPrimitive.Value placeholder={t("activity.classify.chooseOverride", "Choose a category")} />
          )}
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown size={12} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="hra-select-content" position="popper" sideOffset={4}>
          <SelectPrimitive.Viewport>
            {ACTUAL_RUNNING_CATEGORY_ORDER.map(category => {
              const Icon = ACTUAL_RUNNING_CATEGORY_ICONS[category];
              return (
                <SelectPrimitive.Item key={category} value={category} className="hra-select-item" title={label(category)}>
                  <span className="hra-row-inline">
                    <Icon size={14} />
                    <SelectPrimitive.ItemText>{label(category)}</SelectPrimitive.ItemText>
                  </span>
                  <SelectPrimitive.ItemIndicator className="hra-select-item-indicator">
                    <Check size={12} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
