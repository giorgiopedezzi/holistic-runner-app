import { useTranslation } from "react-i18next";

// The one loading experience app-wide (dashboard design-system rework: "use
// the same loading experience everywhere") — an indeterminate accent-toned
// sweep, not a real percentage (nothing granular to report anywhere it's
// used), plus a caller-supplied, localized label naming what's loading.
// `compact` drops the section-loading padding for tight, explicit-height
// spots (e.g. ActivityChartSection's runner row) in favor of filling
// whatever height the parent already reserves.
export function LoadingSpinner({ label, compact }: { label?: string; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="hra-loading" data-compact={compact ? "true" : "false"}>
      <div className="hra-loading-track"><div className="hra-loading-bar" /></div>
      <span className="hra-loading-label">{label ?? t("common.loading", "Loading…")}</span>
    </div>
  );
}
