import { useTranslation } from "react-i18next";

export function LoadingSpinner() {
  const { t } = useTranslation();
  return (
    <div className="hra-text-muted" style={{ padding: "40px 0", textAlign: "center", fontSize: 13 }}>
      {t("common.loading", "Loading…")}
    </div>
  );
}
