import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "@/api/client";
import { AppModeContext, AUTHENTICATED_CAPABILITIES, GUEST_CAPABILITIES } from "@/hooks/useAppMode";
import { resolvePublicUrlToQueryState } from "@/routing/publicUrlBootstrap";

type State = "loading" | "guest" | "unavailable" | "authenticated";
type AuthenticationMethod = "google" | "email" | null;
const AuthMethodContext = createContext<AuthenticationMethod>(null);
export function useAuthenticationMethod() { return useContext(AuthMethodContext); }

// HRA-385 AC7: read once from /api/v1/auth/session, same server-authoritative
// bootstrap pattern authMethod/entitlements already use — plus a setter, so
// AccountPrivacySection's own profile save can push a fresh value straight
// into the sidebar's identity chrome without a second round trip or reload.
const DisplayNameContext = createContext<[string | null, Dispatch<SetStateAction<string | null>>]>([null, () => {}]);
export function useDisplayName() { return useContext(DisplayNameContext); }

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
  const [displayName, setDisplayName] = useState<string | null>(null);

  // Must run synchronously, before children ever mount — AppShell's
  // useUrlState() hooks take their one lazy-init read of window.location on
  // first render, which a useEffect here would run too late to beat. See
  // publicUrlBootstrap.ts.
  resolvePublicUrlToQueryState();

  useEffect(() => {
    let live = true;
    api.auth.session().then(
      (session) => { if (live) { setAuthMethod(session.user.auth_method ?? null); setEntitlements(session.entitlements); setDisplayName(session.user.display_name); setState("authenticated"); } },
      (error: unknown) => {
        if (!live) return;
        setState(error instanceof ApiError && error.status === 401 ? "guest" : "unavailable");
      },
    );
    return () => { live = false; };
  }, []);

  // HRA-374: both resolved states mount the SAME shared AppShell tree (via
  // children) — Guest is a capability set, not a second application. Only
  // the authenticated branch also carries auth-method/entitlement context,
  // which have no meaning for an anonymous founder-public read.
  if (state === "authenticated") {
    return (
      <AppModeContext.Provider value={AUTHENTICATED_CAPABILITIES}>
        <AuthMethodContext.Provider value={authMethod}><EntitlementsContext.Provider value={entitlements}><DisplayNameContext.Provider value={[displayName, setDisplayName]}>{children}</DisplayNameContext.Provider></EntitlementsContext.Provider></AuthMethodContext.Provider>
      </AppModeContext.Provider>
    );
  }
  if (state === "guest") {
    return <AppModeContext.Provider value={GUEST_CAPABILITIES}>{children}</AppModeContext.Provider>;
  }
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
