/**
 * api/client.ts
 * All API calls in one place. Vite proxies /api → localhost:3001 in dev.
 */

import type {
  DateRange, Activity, SportSummary,
  TrackPoint, BodyMeasurement, MonthlyBody, CorrelationPoint,
  DeviceStatus, WithingsStatus, StravaStatus, Settings, Theme, BackgroundKind, StoredUnitSystem,
  ActivityDetailView, AccentColor, TrashedActivity, TrashedBodyMeasurement,
  UserFeedback, CorrectionReason, WorkoutClassification, ClassificationMethod,
  ActivityType, RaceActivity, SavedDateRange, DateFormat, StoredLanguage, Paginated,
} from "@/types/api";

// Sentinel "give me everything" limit for consumers that need the full set
// (charts, previews, bulk actions) rather than a page — see HRA-38. The server
// caps limit at 100000, comfortably above this app's single-user data volumes.
const ALL = "100000";

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
    range:       ()                          => request<DateRange>("/api/v1/range"),
    // Full list (unwrapped) for consumers that need every row in range — trends,
    // classify, delete-preview. Paged UIs use activitiesPage() instead.
    activities:  async (from: string, to: string) => (await request<Paginated<Activity>>("/api/v1/activities", "GET", { ...rp(from, to), limit: ALL })).data,
    activitiesPage: (from: string, to: string, limit: number, offset: number) =>
      request<Paginated<Activity>>("/api/v1/activities", "GET", { ...rp(from, to), limit: String(limit), offset: String(offset) }),
    activity:    (id: number)                => request<Activity>(`/api/v1/activities/${id}`),
    summary:     async (from: string, to: string) => (await request<Paginated<SportSummary>>("/api/v1/summary", "GET", rp(from, to))).data,
    track:       (id: number)                => request<TrackPoint[]>(`/api/v1/activities/${id}/track`),
    count:       (from: string, to: string)  => request<CountResult>("/api/v1/activities/count", "GET", rp(from, to)),
    deleteRange: (from: string, to: string)  => request<DeleteResult>("/api/v1/activities", "DELETE", rp(from, to)),
    deleteOne:   (id: number)                => request<DeleteResult>(`/api/v1/activities/${id}`, "DELETE"),
    sync:        ()                          => request<SyncResult>("/api/v1/sync/garmin", "POST"),
    deviceStatus:()                          => request<DeviceStatus>("/api/v1/garmin/status"),
    // Trash — deletes above are soft (deleted_at set, restorable). These
    // list/restore/permanently-remove what's currently in the trash.
    trash:       async ()                    => (await request<Paginated<TrashedActivity>>("/api/v1/activities/trash", "GET", { limit: ALL })).data,
    restore:     (ids: number[])             => request<RestoreResult>("/api/v1/activities/restore", "POST", undefined, idsBody(ids)),
    purge:       (ids: number[])             => request<PurgeResult>("/api/v1/activities/purge", "POST", undefined, idsBody(ids)),
    // AI workout classifier — always on-demand, never triggered by sync.
    // method defaults server-side to 'ai' when omitted. No bulk-classify
    // endpoint: ManageTab's ClassifySection loops this single-activity call
    // sequentially for real per-item progress — see server.ts's note on why
    // there's no bulk classify route.
    classify:     (id: number, splitMeters?: number, method?: ClassificationMethod) =>
      request<Activity>(`/api/v1/activities/${id}/classify`, "POST", undefined, { splitMeters, method }),
    feedback:     (id: number, body: FeedbackBody) => request<Activity>(`/api/v1/activities/${id}/feedback`, "POST", undefined, body),
    confirmBulk:  (ids: number[], method?: ClassificationMethod) =>
      request<ConfirmResult>("/api/v1/activities/confirm", "POST", undefined, { ids, method }),
    // PUT (full replacement of the {activity_type_id, name} sub-resource) —
    // see garmin-stats' activities.controller.ts setType.
    setType: (id: number, activityTypeId: number, name: string | null) =>
      request<Activity>(`/api/v1/activities/${id}/type`, "PUT", undefined, { activity_type_id: activityTypeId, name }),
    races: async () => (await request<Paginated<RaceActivity>>("/api/v1/activities/races", "GET", { limit: ALL })).data,
  },
  activityTypes: {
    list: async () => (await request<Paginated<ActivityType>>("/api/v1/activity-types", "GET", { limit: ALL })).data,
  },
  // Translation bundles — raw key→string, no envelope (static content, not a
  // collection). Consumed only via i18n.ts's resourcesToBackend loader, so
  // translation fetches go through this one centralized HTTP layer instead of
  // a second parallel fetch mechanism (HRA-104).
  locales: {
    get: (lang: string) => request<Record<string, string>>(`/api/v1/locales/${lang}`),
  },
  dateRanges: {
    list:   async () => (await request<Paginated<SavedDateRange>>("/api/v1/date-ranges", "GET", { limit: ALL })).data,
    create: (name: string, from: string, to: string, activityId: number | null) =>
      request<SavedDateRange>("/api/v1/date-ranges", "POST", undefined, { name, from, to, activity_id: activityId }),
    update: (id: number, name: string, from: string, to: string, activityId: number | null) =>
      request<SavedDateRange>(`/api/v1/date-ranges/${id}`, "PUT", undefined, { name, from, to, activity_id: activityId }),
    remove: (id: number) => request<null>(`/api/v1/date-ranges/${id}`, "DELETE"),
  },
  body: {
    range:       ()                          => request<DateRange>("/api/v1/body-measurements/range"),
    list:        async (from: string, to: string) => (await request<Paginated<BodyMeasurement>>("/api/v1/body-measurements", "GET", { ...rp(from, to), limit: ALL })).data,
    monthly:     async (from: string, to: string) => (await request<Paginated<MonthlyBody>>("/api/v1/body-measurements/monthly", "GET", rp(from, to))).data,
    correlation: async (from: string, to: string) => (await request<Paginated<CorrelationPoint>>("/api/v1/body-measurements/correlation", "GET", rp(from, to))).data,
    count:       (from: string, to: string)  => request<CountResult>("/api/v1/body-measurements/count", "GET", rp(from, to)),
    deleteRange: (from: string, to: string)  => request<DeleteResult>("/api/v1/body-measurements", "DELETE", rp(from, to)),
    sync:        (from?: string, to?: string) => request<SyncResult>("/api/v1/sync/withings", "POST", from && to ? rp(from, to) : undefined),
    tokenStatus: ()                          => request<WithingsStatus>("/api/v1/withings/status"),
    loginUrl:    ()                          => request<{ url: string }>("/api/v1/withings/login-url"),
    trash:       async ()                    => (await request<Paginated<TrashedBodyMeasurement>>("/api/v1/body-measurements/trash", "GET", { limit: ALL })).data,
    restore:     (ids: number[])             => request<RestoreResult>("/api/v1/body-measurements/restore", "POST", undefined, idsBody(ids)),
    purge:       (ids: number[])             => request<PurgeResult>("/api/v1/body-measurements/purge", "POST", undefined, idsBody(ids)),
  },
  strava: {
    sync:        (from?: string, to?: string) => request<SyncResult>("/api/v1/sync/strava", "POST", from && to ? rp(from, to) : undefined),
    tokenStatus: ()                          => request<StravaStatus>("/api/v1/strava/status"),
    loginUrl:    ()                          => request<{ url: string }>("/api/v1/strava/login-url"),
  },
  settings: {
    get:    ()               => request<Settings>("/api/v1/settings"),
    // One dedicated PUT per Settings card — each replaces only its own sub-resource
    // (HRA-40, rest-api §1/§2). There is no write through the parent /settings and
    // no combined call. updateOutliers = the Outlier-detection card's three values;
    // updateThresholds = the Overview & Trends card's single trend-grouping value.
    updateOutliers: (s: Settings) => request<Settings>("/api/v1/settings/outliers", "PUT", undefined, {
      outlier_speed_delta_per_sec: s.outlier_speed_delta_per_sec,
      outlier_cadence_delta_per_sec: s.outlier_cadence_delta_per_sec,
      outlier_min_speed_kmh: s.outlier_min_speed_kmh,
    }),
    updateThresholds: (s: Settings) => request<Settings>("/api/v1/settings/thresholds", "PUT", undefined, {
      min_trend_group_size: s.min_trend_group_size,
    }),
    setTheme: (theme: Theme) => request<Settings>("/api/v1/settings/theme", "PUT", undefined, { theme }),
    setBackground: (kind: BackgroundKind, value?: string) =>
      request<Settings>("/api/v1/settings/background", "PUT", undefined, { background_kind: kind, background_value: value }),
    setUnits: (unitSystem: StoredUnitSystem) => request<Settings>("/api/v1/settings/units", "PUT", undefined, { unit_system: unitSystem }),
    setDetailView: (view: ActivityDetailView) => request<Settings>("/api/v1/settings/detail-view", "PUT", undefined, { activity_detail_view: view }),
    setAccentColor: (accent: AccentColor) => request<Settings>("/api/v1/settings/accent", "PUT", undefined, { accent_color: accent }),
    setDateFormat: (format: DateFormat) => request<Settings>("/api/v1/settings/date-format", "PUT", undefined, { date_format: format }),
    setLanguage: (language: StoredLanguage) => request<Settings>("/api/v1/settings/language", "PUT", undefined, { language }),
    // Not routed through request() — this sends the raw file bytes as the
    // body (Content-Type = the file's own mime type), not a JSON payload.
    uploadBackground: async (file: File): Promise<Settings> => {
      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
      const res = await fetch(`${BASE}/api/v1/settings/background/upload?ext=${encodeURIComponent(ext)}`, {
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
    backgroundImageUrl: (backgroundValue: string) => `${BASE}/api/v1/settings/background-image?v=${encodeURIComponent(backgroundValue)}`,
  },
};
