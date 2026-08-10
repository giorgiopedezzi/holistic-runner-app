/**
 * api/client.ts
 * All API calls in one place. Vite proxies /api → localhost:3001 in dev.
 */

import type {
  DateRange, Activity, SportSummary,
  TrackPoint, BodyMeasurement, MonthlyBody, CorrelationPoint,
  DeviceStatus, WithingsStatus, StravaStatus, Settings, StoredTheme, BackgroundKind, StoredUnitSystem,
  ActivityDetailView, TrashedActivity, TrashedBodyMeasurement,
  UserFeedback, CorrectionReason, WorkoutClassification, ClassificationMethod,
} from "@/types/api";

const BASE = import.meta.env.VITE_API_BASE ?? "";

// Error carrying the HTTP status (0 = the request never reached the server), so
// callers can branch on it if they need to. Its message is already human — see
// buildApiError. (HRA-43)
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// Turn a non-OK response into a human-readable ApiError.
// - 502/503/504: a gateway failure — almost always a long request being dropped
//   (most often the AI classifier, which holds the connection ~15-25s while the
//   local Ollama model runs with stream:false). The request may still have
//   completed server-side; tell the user to wait/retry rather than showing a
//   bare status code.
// - our own 4xx/5xx: surface the API's RFC 7807 problem+json message (HRA-37) —
//   prefer `detail` (occurrence-specific), fall back to `title`, then the code.
async function buildApiError(res: Response, path: string): Promise<ApiError> {
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return new ApiError(res.status, `Couldn't reach the API server (${res.status}). It may be busy, restarting, or a long request (e.g. the AI classifier) timed out — the operation may still have finished, so wait a moment and try again.`);
  }
  const problem = (await res.json().catch(() => null)) as { detail?: string; title?: string } | null;
  const message = problem?.detail ?? problem?.title ?? `API error ${res.status}: ${path}`;
  return new ApiError(res.status, message);
}

async function request<T>(path: string, method = "GET", params?: Record<string, string>, body?: unknown): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    // fetch() rejects only on a network-level failure (server down, connection
    // reset) — never on an HTTP error status. Give the same human message.
    throw new ApiError(0, "Couldn't reach the API server. It may be down, restarting, or a long request was interrupted — the operation may still have finished, so wait a moment and try again.");
  }
  // 204 means "query succeeded, no body". Retained as a general safeguard,
  // though as of HRA-32 no read endpoint returns it (correlation now returns a
  // 200 with []). A caller that can receive it should type as `T | null`.
  if (res.status === 204) return null as T;
  if (!res.ok) throw await buildApiError(res, path);
  return res.json() as Promise<T>;
}

function rp(from: string, to: string) { return { from, to }; }

export interface DeleteResult { deleted: number; from?: string; to?: string; }
export interface SyncResult { imported: number; skipped: number; errors: number; }
export interface CountResult { count: number; }
export interface RestoreResult { restored: number; }
export interface PurgeResult { purged: number; }
export interface ConfirmResult { confirmed: number; }
export interface FeedbackBody {
  feedback: UserFeedback;
  // Which of the two independently-stored classifications (see types/api.ts's
  // Activity) this feedback is about — there's one shared verdict per
  // activity, so approving/rejecting always applies to a specific card.
  source: ClassificationMethod;
  correctionReason?: CorrectionReason;
  finalClassification?: WorkoutClassification;
}

function idsBody(ids: number[]) { return { ids }; }

export const api = {
  garmin: {
    range:       ()                          => request<DateRange>("/api/range"),
    activities:  (from: string, to: string)  => request<Activity[]>("/api/activities", "GET", rp(from, to)),
    activity:    (id: number)                => request<Activity>(`/api/activities/${id}`),
    summary:     (from: string, to: string)  => request<SportSummary[]>("/api/summary", "GET", rp(from, to)),
    track:       (id: number)                => request<TrackPoint[]>(`/api/activities/${id}/track`),
    count:       (from: string, to: string)  => request<CountResult>("/api/activities/count", "GET", rp(from, to)),
    deleteRange: (from: string, to: string)  => request<DeleteResult>("/api/activities", "DELETE", rp(from, to)),
    deleteOne:   (id: number)                => request<DeleteResult>(`/api/activities/${id}`, "DELETE"),
    sync:        ()                          => request<SyncResult>("/api/sync/garmin", "POST"),
    deviceStatus:()                          => request<DeviceStatus>("/api/garmin/status"),
    // Trash — deletes above are soft (deleted_at set, restorable). These
    // list/restore/permanently-remove what's currently in the trash.
    trash:       ()                          => request<TrashedActivity[]>("/api/activities/trash"),
    restore:     (ids: number[])             => request<RestoreResult>("/api/activities/restore", "POST", undefined, idsBody(ids)),
    purge:       (ids: number[])             => request<PurgeResult>("/api/activities/purge", "POST", undefined, idsBody(ids)),
    // AI workout classifier — always on-demand, never triggered by sync.
    // method defaults server-side to 'ai' when omitted. No bulk-classify
    // endpoint: ManageTab's ClassifySection loops this single-activity call
    // sequentially for real per-item progress — see server.ts's note on why
    // there's no bulk classify route.
    classify:     (id: number, splitMeters?: number, method?: ClassificationMethod) =>
      request<Activity>(`/api/activities/${id}/classify`, "POST", undefined, { splitMeters, method }),
    feedback:     (id: number, body: FeedbackBody) => request<Activity>(`/api/activities/${id}/feedback`, "POST", undefined, body),
    confirmBulk:  (ids: number[], method?: ClassificationMethod) =>
      request<ConfirmResult>("/api/activities/confirm", "POST", undefined, { ids, method }),
  },
  body: {
    range:       ()                          => request<DateRange>("/api/body-measurements/range"),
    list:        (from: string, to: string)  => request<BodyMeasurement[]>("/api/body-measurements", "GET", rp(from, to)),
    monthly:     (from: string, to: string)  => request<MonthlyBody[]>("/api/body-measurements/monthly", "GET", rp(from, to)),
    correlation: (from: string, to: string)  => request<CorrelationPoint[]>("/api/body-measurements/correlation", "GET", rp(from, to)),
    count:       (from: string, to: string)  => request<CountResult>("/api/body-measurements/count", "GET", rp(from, to)),
    deleteRange: (from: string, to: string)  => request<DeleteResult>("/api/body-measurements", "DELETE", rp(from, to)),
    sync:        (from?: string, to?: string) => request<SyncResult>("/api/sync/withings", "POST", from && to ? rp(from, to) : undefined),
    tokenStatus: ()                          => request<WithingsStatus>("/api/withings/status"),
    loginUrl:    ()                          => request<{ url: string }>("/api/withings/login-url"),
    trash:       ()                          => request<TrashedBodyMeasurement[]>("/api/body-measurements/trash"),
    restore:     (ids: number[])             => request<RestoreResult>("/api/body-measurements/restore", "POST", undefined, idsBody(ids)),
    purge:       (ids: number[])             => request<PurgeResult>("/api/body-measurements/purge", "POST", undefined, idsBody(ids)),
  },
  strava: {
    sync:        (from?: string, to?: string) => request<SyncResult>("/api/sync/strava", "POST", from && to ? rp(from, to) : undefined),
    tokenStatus: ()                          => request<StravaStatus>("/api/strava/status"),
    loginUrl:    ()                          => request<{ url: string }>("/api/strava/login-url"),
  },
  settings: {
    get:    ()               => request<Settings>("/api/settings"),
    update: (s: Settings)    => request<Settings>("/api/settings", "PUT", undefined, s),
    setTheme: (theme: StoredTheme) => request<Settings>("/api/settings/theme", "PUT", undefined, { theme }),
    setBackground: (kind: BackgroundKind, value?: string) =>
      request<Settings>("/api/settings/background", "PUT", undefined, { background_kind: kind, background_value: value }),
    setUnits: (unitSystem: StoredUnitSystem) => request<Settings>("/api/settings/units", "PUT", undefined, { unit_system: unitSystem }),
    setDetailView: (view: ActivityDetailView) => request<Settings>("/api/settings/detail-view", "PUT", undefined, { activity_detail_view: view }),
    // Not routed through request() — this sends the raw file bytes as the
    // body (Content-Type = the file's own mime type), not a JSON payload.
    uploadBackground: async (file: File): Promise<Settings> => {
      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
      const res = await fetch(`${BASE}/api/settings/background/upload?ext=${encodeURIComponent(ext)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status}): ${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
      return res.json() as Promise<Settings>;
    },
    // Cache-busted by background_value (which changes on every upload/
    // preset switch) so the browser can't serve a stale cached image after
    // the user picks a different one.
    backgroundImageUrl: (backgroundValue: string) => `${BASE}/api/settings/background-image?v=${encodeURIComponent(backgroundValue)}`,
  },
};
