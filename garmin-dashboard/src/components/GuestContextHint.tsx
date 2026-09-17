import { useTranslation } from "react-i18next";
import { LogIn } from "lucide-react";
import { api } from "@/api/client";
import { useAppMode } from "@/hooks/useAppMode";

interface Props {
  titleKey: string;
  title: string;
  bodyKey: string;
  body: string;
  ctaKey?: string;
  cta?: string;
}

// A deliberately small, in-flow annotation for the shared product views.
// It owns no Guest state: AppMode remains the single capability authority.
export function GuestContextHint({ titleKey, title, bodyKey, body, ctaKey, cta }: Props) {
  const { t } = useTranslation();
  const { mode } = useAppMode();
  if (mode !== "guest") return null;

  return (
    <aside className="hra-guest-context-hint" aria-label={t(titleKey, title)}>
      <div className="min-w-0">
        <p className="hra-text-primary text-label font-semibold">{t(titleKey, title)}</p>
        <p className="hra-text-secondary text-meta">{t(bodyKey, body)}</p>
      </div>
      {cta && ctaKey && (
        <button type="button" className="hra-guest-context-cta" onClick={() => api.auth.login()}>
          <LogIn size={15} aria-hidden="true" />
          {t(ctaKey, cta)}
        </button>
      )}
    </aside>
  );
}
