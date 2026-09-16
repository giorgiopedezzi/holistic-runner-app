import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthGate, useAuthenticationMethod, useEntitlements } from "./AuthGate";
import { useAppMode } from "@/hooks/useAppMode";
import { ApiError, api } from "@/api/client";

// HRA-374: AuthGate no longer forks between GuestShell and the private
// children — Guest and authenticated visitors both mount the SAME children,
// differing only in the AppModeContext (and, for authenticated, the auth
// method/entitlement context) it wraps them in. This probe reads exactly
// that context, the same way a real consumer (App.tsx, useSettings.tsx)
// would, instead of asserting on which component tree got rendered.
function Probe() {
  const { mode, canPersist, canManageAccount } = useAppMode();
  const authMethod = useAuthenticationMethod();
  const entitlements = useEntitlements();
  return (
    <div>
      <span>mode:{mode}</span>
      <span>canPersist:{String(canPersist)}</span>
      <span>canManageAccount:{String(canManageAccount)}</span>
      <span>authMethod:{authMethod ?? "none"}</span>
      <span>entitlements:{entitlements.join(",") || "none"}</span>
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("AuthGate", () => {
  it("resolves Guest capabilities on a 401 session, mounting the same shared children with no auth-method/entitlement context", async () => {
    vi.spyOn(api.auth, "session").mockRejectedValue(new ApiError(401, "Authentication is required."));

    render(<AuthGate><Probe /></AuthGate>);

    expect(await screen.findByText("mode:guest")).toBeInTheDocument();
    expect(screen.getByText("canPersist:false")).toBeInTheDocument();
    expect(screen.getByText("canManageAccount:false")).toBeInTheDocument();
    expect(screen.getByText("authMethod:none")).toBeInTheDocument();
    expect(screen.getByText("entitlements:none")).toBeInTheDocument();
  });

  it("resolves authenticated capabilities and carries the real auth method/entitlements for a real session", async () => {
    vi.spyOn(api.auth, "session").mockResolvedValue({
      user: { id: "founder", display_name: "Founder", locale: "en", unit_system: "metric", timezone: "Europe/Rome", role: "admin", auth_method: "google" },
      entitlements: ["founder_publication"], csrfToken: "test-csrf",
    });

    render(<AuthGate><Probe /></AuthGate>);

    expect(await screen.findByText("mode:authenticated")).toBeInTheDocument();
    expect(screen.getByText("canPersist:true")).toBeInTheDocument();
    expect(screen.getByText("canManageAccount:true")).toBeInTheDocument();
    expect(screen.getByText("authMethod:google")).toBeInTheDocument();
    expect(screen.getByText("entitlements:founder_publication")).toBeInTheDocument();
  });

  it("shows a checking-session message, not either resolved mode, while the session request is in flight", async () => {
    type Session = Awaited<ReturnType<typeof api.auth.session>>;
    let resolveSession!: (value: Session) => void;
    vi.spyOn(api.auth, "session").mockReturnValue(new Promise<Session>(resolve => { resolveSession = resolve; }));

    render(<AuthGate><Probe /></AuthGate>);

    expect(screen.getByText("Checking your secure session…")).toBeInTheDocument();
    expect(screen.queryByText(/^mode:/)).not.toBeInTheDocument();

    resolveSession({ user: { id: "founder", display_name: null, locale: null, unit_system: null, timezone: null, role: "admin" }, entitlements: [], csrfToken: "t" });
    expect(await screen.findByText("mode:authenticated")).toBeInTheDocument();
  });

  it("normalizes a /p/founder-journey/activities/:id public URL into the shared tab/query-state model before the children mount", async () => {
    window.history.replaceState({}, "", "/p/founder-journey/activities/42");
    vi.spyOn(api.auth, "session").mockRejectedValue(new ApiError(401, "Authentication is required."));

    render(<AuthGate><Probe /></AuthGate>);
    await screen.findByText("mode:guest");

    expect(window.location.pathname).toBe("/");
    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("activities");
    expect(params.get("activityId")).toBe("42");
  });
});
