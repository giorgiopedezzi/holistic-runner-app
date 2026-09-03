import { useTranslation } from "react-i18next";

interface EmptyProps {
  message?: string;
  // HRA-248: an optional second line, rendered with slightly more visual
  // emphasis than `message` — e.g. "Your agenda"'s empty-state payoff line.
  // Additive; every pre-existing call site passes only `message`.
  emphasis?: string;
  // HRA-248: an optional secondary CTA below the message(s) — never an
  // error affordance, this component stays icon-free and non-alarming.
  action?: { label: string; onClick: () => void };
}

export function Empty({ message, emphasis, action }: EmptyProps) {
  const { t } = useTranslation();
  return (
    <div className="hra-empty flex flex-col items-center gap-2">
      <p>{message ?? t("common.noDataDefault", "No data in this range.")}</p>
      {emphasis && <p className="text-heading">{emphasis}</p>}
      {action && (
        <button type="button" className="hra-btn" data-variant="outline" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
