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

async function request<T>(path: string, method = "GET", params?: Record<string, string>, body?: unknown): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method,
    ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  // 204 means "query succeeded, deliberately nothing to show" (e.g. no
  // overlapping data for correlation) — distinct from a 200 empty array,
  // which callers that can receive it should type as `T | null`.
  if (res.status === 204) return null as T;
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
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
    activity:    (id: number)                => request<Activity>(`/api/activity/${id}`),
    summary:     (from: string, to: string)  => request<SportSummary[]>("/api/summary", "GET", rp(from, to)),
    track:       (id: number)                => request<TrackPoint[]>(`/api/track/${id}`),
    count:       (from: string, to: string)  => request<CountResult>("/api/activities/count", "GET", rp(from, to)),
    deleteRange: (from: string, to: string)  => request<DeleteResult>("/api/activities", "DELETE", rp(from, to)),
    deleteOne:   (id: number)                => request<DeleteResult>(`/api/activity/${id}`, "DELETE"),
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
      request<Activity>(`/api/activity/${id}/classify`, "POST", undefined, { splitMeters, method }),
    feedback:     (id: number, body: FeedbackBody) => request<Activity>(`/api/activity/${id}/feedback`, "POST", undefined, body),
    confirmBulk:  (ids: number[], method?: ClassificationMethod) =>
      request<ConfirmResult>("/api/activities/confirm", "POST", undefined, { ids, method }),
  },
  body: {
    range:       ()                          => request<DateRange>("/api/body/range"),
    list:        (from: string, to: string)  => request<BodyMeasurement[]>("/api/body/list", "GET", rp(from, to)),
    monthly:     (from: string, to: string)  => request<MonthlyBody[]>("/api/body/monthly", "GET", rp(from, to)),
    correlation: (from: string, to: string)  => request<CorrelationPoint[] | null>("/api/body/correlation", "GET", rp(from, to)),
    count:       (from: string, to: string)  => request<CountResult>("/api/body/count", "GET", rp(from, to)),
    deleteRange: (from: string, to: string)  => request<DeleteResult>("/api/body", "DELETE", rp(from, to)),
    sync:        (from?: string, to?: string) => request<SyncResult>("/api/sync/withings", "POST", from && to ? rp(from, to) : undefined),
    tokenStatus: ()                          => request<WithingsStatus>("/api/withings/status"),
    loginUrl:    ()                          => request<{ url: string }>("/api/withings/login-url"),
    trash:       ()                          => request<TrashedBodyMeasurement[]>("/api/body/trash"),
    restore:     (ids: number[])             => request<RestoreResult>("/api/body/restore", "POST", undefined, idsBody(ids)),
    purge:       (ids: number[])             => request<PurgeResult>("/api/body/purge", "POST", undefined, idsBody(ids)),
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
