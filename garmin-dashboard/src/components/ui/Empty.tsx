import { useTranslation } from "react-i18next";

export function Empty({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <div className="hra-empty">
      {message ?? t("common.noDataDefault", "No data in this range.")}
    </div>
  );
}
