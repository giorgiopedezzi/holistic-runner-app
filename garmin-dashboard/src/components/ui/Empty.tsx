import { useTranslation } from "react-i18next";

export function Empty({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <div className="hra-text-muted" style={{ padding: "40px 0", textAlign: "center", fontSize: 14 }}>
      {message ?? t("common.noDataDefault", "No data in this range.")}
    </div>
  );
}
