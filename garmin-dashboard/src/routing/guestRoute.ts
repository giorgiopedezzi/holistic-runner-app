export type GuestView = "journey" | "plan" | "activities" | "reports";

export interface GuestRoute {
  slug: string;
  view: GuestView;
  activityId: string | null;
  reportId: string | null;
}

export const DEFAULT_FOUNDER_SLUG = "founder-journey";

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// Parses the public Guest route family (HRA-368): `/p/:slug`, `/p/:slug/plan`,
// `/p/:slug/activities[/:publicId]`, `/p/:slug/progress`, and
// `/p/:slug/reports/:publicId`. Anything outside that family — including a
// bare "/" for the default anonymous landing, and an unrecognized sub-path
// under a known slug — resolves to that slug's journey view rather than
// guessing, so a mistyped or stale URL never silently reveals a different
// resource or crashes the shell.
export function parseGuestRoute(pathname: string): GuestRoute {
  const match = /^\/p\/([^/]+)((?:\/[^/]+)*)\/?$/.exec(pathname);
  if (!match) return { slug: DEFAULT_FOUNDER_SLUG, view: "journey", activityId: null, reportId: null };

  const slug = decodeSegment(match[1]);
  const segments = (match[2] ?? "").split("/").filter(Boolean);

  if (segments.length === 0) return { slug, view: "journey", activityId: null, reportId: null };
  if (segments.length === 1 && segments[0] === "plan") return { slug, view: "plan", activityId: null, reportId: null };
  if (segments[0] === "activities" && segments.length <= 2) {
    return { slug, view: "activities", activityId: segments[1] ? decodeSegment(segments[1]) : null, reportId: null };
  }
  if (segments.length === 1 && segments[0] === "progress") return { slug, view: "reports", activityId: null, reportId: null };
  if (segments.length === 2 && segments[0] === "reports") {
    return { slug, view: "reports", activityId: null, reportId: decodeSegment(segments[1]) };
  }

  return { slug, view: "journey", activityId: null, reportId: null };
}

export function guestPath(slug: string, view: GuestView, id?: string | null): string {
  const base = `/p/${encodeURIComponent(slug)}`;
  if (view === "plan") return `${base}/plan`;
  if (view === "activities") return id ? `${base}/activities/${encodeURIComponent(id)}` : `${base}/activities`;
  if (view === "reports") return id ? `${base}/reports/${encodeURIComponent(id)}` : `${base}/progress`;
  return base;
}
