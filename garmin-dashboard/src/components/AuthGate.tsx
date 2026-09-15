import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "@/api/client";

type State = "loading" | "signed-out" | "unavailable" | "authenticated";

// Bootstrap is deliberately server-authoritative: no owner, role, entitlement,
// provider token, or session claim is accepted from browser state.
export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let live = true;
    api.auth.session().then(
      () => { if (live) setState("authenticated"); },
      (error: unknown) => {
        if (!live) return;
        setState(error instanceof ApiError && error.status === 401 ? "signed-out" : "unavailable");
      },
    );
    return () => { live = false; };
  }, []);

  if (state === "authenticated") return <>{children}</>;
  const message = state === "loading"
    ? t("auth.loading", "Checking your secure session…")
    : state === "unavailable"
      ? t("auth.unavailable", "Sign-in is temporarily unavailable. Please try again.")
      : t("auth.signInPrompt", "Sign in to Runs Free.");
  return (
    <main className="min-h-screen flex items-center justify-center p-6" aria-live="polite">
      <section className="hra-bg-card hra-border-strong rounded-xl p-6 max-w-md text-center">
        <p className="text-body">{message}</p>
        {state === "signed-out" && (
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" className="hra-nav-hover hra-border-strong rounded-lg px-4 py-2 text-label" onClick={() => api.auth.login("google")}>
              {t("auth.continueWithGoogle", "Continue with Google")}
            </button>
            <button type="button" className="hra-nav-hover hra-border-strong rounded-lg px-4 py-2 text-label" onClick={() => api.auth.login("email")}>
              {t("auth.continueWithEmailCode", "Continue with email code")}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
