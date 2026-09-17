import { useTranslation } from "react-i18next";
import { LogIn } from "lucide-react";
import { api } from "@/api/client";

// HRA-381: the one canonical Guest auth CTA — visible label is always
// "Sign in"; the surrounding context owns the reason, this link never does.
export function SignInLink({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <button type="button" className={`hra-sign-in-link${className ? ` ${className}` : ""}`} onClick={() => api.auth.login()}>
      <LogIn size={15} aria-hidden="true" />
      {t("guest.signIn", "Sign in")}
    </button>
  );
}
