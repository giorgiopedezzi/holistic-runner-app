import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "@/api/client";
import { GuestShell } from "@/components/GuestShell";

type State = "loading" | "guest" | "unavailable" | "authenticated";
type AuthenticationMethod = "google" | "email" | null;
const AuthMethodContext = createContext<AuthenticationMethod>(null);
export function useAuthenticationMethod() { return useContext(AuthMethodContext); }

// HRA-370: the founder publication entitlement (and any future one) surfaced
// the same server-authoritative way auth method already is — read once from
// /api/v1/auth/session, never derived from client state.
const EntitlementsContext = createContext<string[]>([]);
export function useEntitlements() { return useContext(EntitlementsContext); }

// Bootstrap is deliberately server-authoritative: no owner, role, entitlement,
// provider token, or session claim is accepted from browser state.
export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>("loading");
  const [authMethod, setAuthMethod] = useState<AuthenticationMethod>(null);
  const [entitlements, setEntitlements] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    api.auth.session().then(
      (session) => { if (live) { setAuthMethod(session.user.auth_method ?? null); setEntitlements(session.entitlements); setState("authenticated"); } },
      (error: unknown) => {
        if (!live) return;
        setState(error instanceof ApiError && error.status === 401 ? "guest" : "unavailable");
      },
    );
    return () => { live = false; };
  }, []);

  if (state === "authenticated") {
    return <AuthMethodContext.Provider value={authMethod}><EntitlementsContext.Provider value={entitlements}>{children}</EntitlementsContext.Provider></AuthMethodContext.Provider>;
  }
  if (state === "guest") return <GuestShell />;
  const message = state === "loading"
    ? t("auth.loading", "Checking your secure session…")
    : t("auth.unavailable", "Sign-in is temporarily unavailable. Please try again.");
  return (
    <main className="min-h-screen flex items-center justify-center p-6" aria-live="polite">
      <section className="hra-bg-card hra-border-strong rounded-xl p-6 max-w-md text-center">
        <p className="text-body">{message}</p>
      </section>
    </main>
  );
}
