import { parseGuestRoute } from "./guestRoute";

// HRA-374: the stable /p/:slug public route family (guestRoute.ts's parser,
// still shared with GuestOverview.tsx's own standalone/preview use) now maps
// into the normal AppShell's tab/query-state model instead of a parallel
// Guest router — the founder's data is served through the same domain
// endpoints every tab already calls (HRA-373), addressed by the same internal
// ids, so a public activity/plan view IS the shared tab, not a separate one.
// The slug itself carries no meaning any more (the live-read backend fixes
// the owner to FOUNDER_USER_ID server-side, never by slug), so it's dropped.
type PublicTabId = "agenda" | "plans" | "overview" | "activities";

function tabStateForRoute(view: ReturnType<typeof parseGuestRoute>["view"], activityId: string | null): { tab: PublicTabId; activityId: string | null } {
  if (view === "plan") return { tab: "plans", activityId: null };
  if (view === "activities") return { tab: "activities", activityId };
  // "reports"/"progress" has no direct equivalent in the shared shell yet
  // (the report modals it used to link to live under the private Manage
  // tab) — Overview & Trends is the closest shared reading of "progress",
  // see the HRA-374 review comment's deviations note.
  if (view === "reports") return { tab: "overview", activityId: null };
  return { tab: "agenda", activityId: null };
}

// Synchronous and idempotent by construction (a /p/ pathname is rewritten to
// "/" on its first call, so a second call is a no-op) — must run BEFORE
// AppShell's own useUrlState() hooks take their first (synchronous, lazy-init)
// read of window.location, which rules out doing this in a useEffect. Called
// directly from AuthGate's render body for that ordering guarantee.
export function resolvePublicUrlToQueryState(location: Pick<Location, "pathname" | "search" | "hash"> = window.location): void {
  if (!/^\/p\//.test(location.pathname)) return;
  const route = parseGuestRoute(location.pathname);
  const { tab, activityId } = tabStateForRoute(route.view, route.activityId);

  const params = new URLSearchParams(location.search);
  params.set("tab", tab);
  if (activityId) params.set("activityId", activityId);
  const query = params.toString();
  window.history.replaceState(window.history.state, "", `/${query ? `?${query}` : ""}${location.hash}`);
}
