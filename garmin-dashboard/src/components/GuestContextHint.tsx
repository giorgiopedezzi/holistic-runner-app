import { useTranslation } from "react-i18next";
import { useAppMode } from "@/hooks/useAppMode";
import { SignInLink } from "@/components/SignInLink";

interface Props {
  titleKey: string;
  title: string;
  bodyKey: string;
  body: string;
}

// A deliberately small, in-flow annotation for the shared product views.
// It owns no Guest state: AppMode remains the single capability authority.
// HRA-381: the CTA is always the canonical SignInLink — this component's
// title/body own the contextual reason, the link label never does.
export function GuestContextHint({ titleKey, title, bodyKey, body }: Props) {
  const { t } = useTranslation();
  const { mode } = useAppMode();
  if (mode !== "guest") return null;

  return (
    <aside className="hra-guest-context-hint" aria-label={t(titleKey, title)}>
      <div className="min-w-0">
        <p className="hra-text-primary text-label font-semibold">{t(titleKey, title)}</p>
        <p className="hra-text-secondary text-meta">{t(bodyKey, body)}</p>
      </div>
      <SignInLink className="hra-guest-context-cta" />
    </aside>
  );
}
