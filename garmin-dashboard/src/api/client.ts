/**
 * api/client.ts
 * All API calls in one place. Vite proxies /api → localhost:3001 in dev.
 */

import type {
  DateRange, Activity, SportSummary,
  TrackPoint, BodyMeasurement, MonthlyBody, CorrelationPoint,
  DeviceStatus, WithingsStatus, StravaStatus, Settings, Theme, BackgroundKind, StoredUnitSystem,
  ActivityDetailView, AccentColor, TrashedActivity, TrashedBodyMeasurement,
  UserFeedback, CorrectionReason, ActualRunningClassification, ClassificationMethod,
  ActivityType, RaceActivity, SavedDateRange, DateFormat, StoredLanguage, Paginated, PlanTemplate,
  PlanInstance, PlanInstanceWithDays, PlanInstanceDay, PlanInstanceDayWithInstance, Palette,
  FeedbackSubmission, FeedbackEntry, AssociationView, WorkoutReport, WeekReport, PlanReport, ReportRangeMode, RangeReport,
} from "@/types/api";
import type { EventType, ParseWarning, ResolvedSegment, RunPlan, Target, WorkoutType } from "@/types/runplan";
import type { PublicItem } from "@/components/GuestOverview";

// Sentinel "give me everything" limit for consumers that need the full set
// (charts, previews, bulk actions) rather than a page — see HRA-38. The server
// caps limit at 100000, comfortably above this app's single-user data volumes.
const ALL = "100000";

const BASE = import.meta.env.VITE_API_BASE ?? "";
let csrfToken: string | null = null;

// HRA-249: the structured conflict body on POST .../plan-instances/:id/approve's
// 409 — every already-approved instance whose resolved date range overlaps the
// candidate being activated, mirroring garmin-stats/src/http/problem.ts's
// Problem.overlaps.
export interface PlanInstanceOverlapConflict {
  id: number;
  name: string | null;
  start_date: string;
  end_date: string;
  overlap_start: string;
  overlap_end: string;
}
export interface PlanInstanceOverlaps {
  candidate: { id: number; name: string | null; start_date: string; end_date: string };
  conflicts: PlanInstanceOverlapConflict[];
}

// HRA-299: the structured conflict body on POST .../plan-instances/:id/regenerate's
// 409 — every currently-persisted day in the requested range that already
// carries a customization marker and would be silently overwritten without
// confirm_overwrite: true, mirroring problem.ts's Problem.customized_days.
export interface PlanInstanceCustomizedDay {
  id: number;
  date: string;
  section_name: string;
  week_number: number;
  day: number;
  workout_type: string;
  notes: string | null;
}

// HRA-327: response of POST /api/v1/source-files/extract — normalized plan
// text extracted server-side from an uploaded .txt/.csv/.pdf, for hand-off
// into the plan-template pipeline's "Plan text" stage (HRA-328).
export interface SourceExtractionResult {
  sourceText: string;
  sourceType: "txt" | "csv" | "pdf";
  fileName: string;
  pageCount?: number;
}

// HRA-370: founder-only publication controls over the existing HRA-360
// lifecycle. Never carries an owner UUID or a private resource id — see
// garmin-stats/src/services/publication-lifecycle.service.ts.
export interface PublicationStatus {
  state: "draft" | "published" | "suspended" | "unconfigured";
  publicUrl: string | null;
  projectedAt: string | null;
  lastError: "projection_refresh_failed" | null;
  canRetry: boolean;
}
export interface PublicationPreview extends PublicationStatus {
  snapshot: PublicProjectionSnapshot;
  sourceVersion: string;
}
export interface PublicProjectionSnapshot {
  schemaVersion: number;
  slug: string;
  sourceVersion: string;
  projectedAt: string;
  profile: PublicItem | null;
  activities: PublicItem[];
  plans: PublicItem[];
  reports: PublicItem[];
}

// HRA-391: the structured allowance body on a metered FIT export action's
// 429, mirroring garmin-stats/src/http/problem.ts's Problem.allowance.
export interface ExportAllowanceInfo {
  remaining: number;
  required: number;
  next_credit_at: string | null;
}

// HRA-391: GET /api/v1/export-allowance's response — unlimited:true alone
// for the founder (no fabricated numeric balance), otherwise the rolling
// window's actual remaining/limit/next-credit state.
export interface ExportAllowanceStatus {
  unlimited: boolean;
  limit?: number;
  remaining?: number;
  next_credit_at: string | null;
  costs: { single: number; week: number };
}

// Error carrying the HTTP status (0 = the request never reached the server), so
// callers can branch on it if they need to. Its message is already human — see
// buildApiError. (HRA-43) `overlaps` is set only for a plan-instance activation
// conflict (HRA-249); `customizedDays` (HRA-299) only for a regenerate
// customization-overwrite conflict; `allowance` (HRA-391) only for a metered
// FIT export action's 429 — every other caller leaves all three undefined.
export class ApiError extends Error {
  constructor(
    public readonly status: number, message: string,
    public readonly overlaps?: PlanInstanceOverlaps, public readonly customizedDays?: PlanInstanceCustomizedDay[],
    public readonly allowance?: ExportAllowanceInfo,
  ) {
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
// i18next.t() is reached via a dynamic import, not a static one — a static
// `import i18next from "@/i18n"` here creates a real circular dependency
// (i18n.ts's resourcesToBackend loader itself calls api.locales.get(),
// defined in this file) that broke useAppearance's matchMedia-mock test
// with a hang, apparently from the two modules' evaluation order rather
// than anything both files' *code* does wrong. A dynamic import resolves
// after both modules have already finished loading (this only ever runs
// once an actual request is in flight, long after app startup), sidestepping
// the ordering problem entirely — verified fixed, 133/133 tests pass.
async function translate(key: string, defaultValue: string, options?: Record<string, unknown>): Promise<string> {
  const { default: i18next } = await import("@/i18n");
  return i18next.t(key, defaultValue, options);
}

async function buildApiError(res: Response, path: string): Promise<ApiError> {
  const problem = (await res.json().catch(() => null)) as {
    detail?: string; title?: string; overlaps?: PlanInstanceOverlaps; customized_days?: PlanInstanceCustomizedDay[];
    allowance?: ExportAllowanceInfo;
  } | null;
  // A real problem+json body (this app's own backend, e.g. HRA-329's AI
  // provider error mapping) always carries detail/title — show that specific
  // message. Only a raw, unparseable 502/503/504 (a reverse proxy/infra
  // failure with an HTML/empty body, not this app's own response) falls back
  // to the generic "give it a moment" copy below.
  if (problem == null && (res.status === 502 || res.status === 503 || res.status === 504)) {
    return new ApiError(res.status, await translate("api.gatewayError",
      `Couldn't reach the API server (${res.status}). It may be busy, restarting, or a long request (e.g. the AI classifier) timed out — the operation may still have finished, so wait a moment and try again.`,
      { status: res.status }));
  }
  const message = problem?.detail ?? problem?.title ?? await translate("api.genericError", `API error ${res.status}: ${path}`, { status: res.status, path });
  return new ApiError(res.status, message, problem?.overlaps, problem?.customized_days, problem?.allowance);
}

async function request<T>(path: string, method = "GET", params?: Record<string, string>, body?: unknown): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  let res: Response;
  try {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (!["GET", "HEAD"].includes(method) && csrfToken) headers["X-RunsFree-CSRF"] = csrfToken;
    res = await fetch(url.toString(), {
      method,
      credentials: "include",
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // fetch() rejects only on a network-level failure (server down, connection
    // reset) — never on an HTTP error status. Give the same human message.
    throw new ApiError(0, await translate("api.networkError", "Couldn't reach the API server. It may be down, restarting, or a long request was interrupted — the operation may still have finished, so wait a moment and try again."));
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
export interface FitImportResult { filename: string; status: "imported" | "duplicate" | "failed"; reason?: string; }
export interface FitBatchImportResult {
  results: FitImportResult[];
  summary: { imported: number; duplicates: number; failed: number };
}
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
  // The legacy AI/statistical thumbs-up/down flow this belongs to predates
  // HRA-394's actual-running taxonomy and is out of this Story's scope
  // (Feedback boundary) — loosely typed rather than importing the retired
  // WorkoutClassification enum, since nothing in the frontend currently
  // calls api.garmin.feedback() at all.
  finalClassification?: string;
}

function idsBody(ids: number[]) { return { ids }; }

export const api = {
  auth: {
    session: async () => {
      const session = await request<{ user: { id: string; display_name: string | null; locale: string | null; unit_system: "metric" | "imperial" | null; timezone: string | null; role: "user" | "admin"; auth_method?: "google" | "email" | null }; entitlements: string[]; csrfToken: string }>("/api/v1/auth/session");
      csrfToken = session.csrfToken;
      return session;
    },
    login: (method?: "google" | "email") => {
      const url = new URL(`${BASE}/api/v1/auth/login`, window.location.origin);
      if (method) url.searchParams.set("method", method);
      window.location.assign(url.toString());
    },
    logout: async () => { await request<null>("/api/v1/auth/logout", "POST"); csrfToken = null; },
  },
  account: {
    updateProfile: (body: { display_name: string | null; locale: string | null; unit_system: "metric" | "imperial" | null; timezone: string | null }) =>
      request<{ display_name: string | null; locale: string | null; unit_system: "metric" | "imperial" | null; timezone: string | null }>("/api/v1/account/profile", "PUT", undefined, body),
    revokeOtherSessions: () => request<{ revoked: boolean }>("/api/v1/account/sessions/revoke-others", "POST"),
    createExport: () => request<{ expires_at: string; download_url: string }>("/api/v1/account/exports", "POST"),
    requestDeletion: () => request<{ status: string }>("/api/v1/account/deletion-request", "POST", undefined, { confirmation: "DELETE MY ACCOUNT" }),
  },
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
    importFitZip: async (file: File): Promise<FitBatchImportResult> => {
      const path = "/api/v1/imports/fit-zip";
      const headers: Record<string, string> = { "Content-Type": file.type || "application/zip" };
      if (csrfToken) headers["X-RunsFree-CSRF"] = csrfToken;
      let res: Response;
      try {
        res = await fetch(`${BASE}${path}`, { method: "POST", credentials: "include", headers, body: file });
      } catch {
        throw new ApiError(0, await translate("api.networkError", "Couldn't reach the API server. It may be down, restarting, or a long request was interrupted - the operation may still have finished, so wait a moment and try again."));
      }
      if (!res.ok) throw await buildApiError(res, path);
      return res.json() as Promise<FitBatchImportResult>;
    },
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
    classify:     (id: number, splitMeters?: number) =>
      request<Activity>(`/api/v1/activities/${id}/classify`, "POST", undefined, { splitMeters }),
    overrideClassification: (id: number, classification: ActualRunningClassification) =>
      request<Activity>(`/api/v1/activities/${id}/classification-override`, "PUT", undefined, { classification }),
    restoreSystemClassification: (id: number) =>
      request<Activity>(`/api/v1/activities/${id}/classification-override`, "DELETE"),
    feedback:     (id: number, body: FeedbackBody) => request<Activity>(`/api/v1/activities/${id}/feedback`, "POST", undefined, body),
    confirmBulk:  (ids: number[], method?: ClassificationMethod) =>
      request<ConfirmResult>("/api/v1/activities/confirm", "POST", undefined, { ids, method }),
    // PUT (full replacement of the {activity_type_id, name} sub-resource) —
    // see garmin-stats' activities.controller.ts setType.
    setType: (id: number, activityTypeId: number, name: string | null) =>
      request<Activity>(`/api/v1/activities/${id}/type`, "PUT", undefined, { activity_type_id: activityTypeId, name }),
    races: async () => (await request<Paginated<RaceActivity>>("/api/v1/activities/races", "GET", { limit: ALL })).data,
    // HRA-334: the persisted planned-workout link — see docs/schema.md's
    // workout_associations section. get() returns an all-null AssociationView
    // (never a 404) when nothing has been linked yet.
    association: (id: number) => request<AssociationView>(`/api/v1/activities/${id}/association`),
    associationCandidates: (id: number) => request<PlanInstanceDayWithInstance[]>(`/api/v1/activities/${id}/association-candidates`),
    setAssociation: (id: number, workoutId: string) =>
      request<AssociationView>(`/api/v1/activities/${id}/association`, "PUT", undefined, { workout_id: workoutId }),
    clearAssociation: (id: number) => request<AssociationView>(`/api/v1/activities/${id}/association`, "DELETE"),
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
  feedback: {
    // POST /api/v1/feedback (HRA-226) — deliberately never gated by DEMO_MODE
    // server-side, since demo visitors are a primary source of submissions.
    submit: (body: FeedbackSubmission) => request<FeedbackEntry>("/api/v1/feedback", "POST", undefined, body),
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
    disconnect:  ()                          => request<{ disconnected: boolean }>("/api/v1/withings/connection", "DELETE"),
    trash:       async ()                    => (await request<Paginated<TrashedBodyMeasurement>>("/api/v1/body-measurements/trash", "GET", { limit: ALL })).data,
    restore:     (ids: number[])             => request<RestoreResult>("/api/v1/body-measurements/restore", "POST", undefined, idsBody(ids)),
    purge:       (ids: number[])             => request<PurgeResult>("/api/v1/body-measurements/purge", "POST", undefined, idsBody(ids)),
  },
  strava: {
    sync:        (from?: string, to?: string) => request<SyncResult>("/api/v1/sync/strava", "POST", from && to ? rp(from, to) : undefined),
    tokenStatus: ()                          => request<StravaStatus>("/api/v1/strava/status"),
    loginUrl:    ()                          => request<{ url: string }>("/api/v1/strava/login-url"),
    disconnect:  ()                          => request<{ disconnected: boolean }>("/api/v1/strava/connection", "DELETE"),
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
    updateAthleteMetrics: (metrics: Pick<Settings, "current_easy_pace_sec_per_km" | "current_race_pace_sec_per_km" | "current_long_run_target_m">) =>
      request<Settings>("/api/v1/settings/athlete-metrics", "PUT", undefined, metrics),
    setDetailView: (view: ActivityDetailView) => request<Settings>("/api/v1/settings/detail-view", "PUT", undefined, { activity_detail_view: view }),
    setAccentColor: (accent: AccentColor) => request<Settings>("/api/v1/settings/accent", "PUT", undefined, { accent_color: accent }),
    setDateFormat: (format: DateFormat) => request<Settings>("/api/v1/settings/date-format", "PUT", undefined, { date_format: format }),
    setLanguage: (language: StoredLanguage) => request<Settings>("/api/v1/settings/language", "PUT", undefined, { language }),
    setPalette: (palette: Palette) => request<Settings>("/api/v1/settings/palette", "PUT", undefined, { palette }),
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
  planTemplates: {
    list:   async () => (await request<Paginated<PlanTemplate>>("/api/v1/plan-templates", "GET", { limit: ALL })).data,
    // Parse-only preview, never persists (HRA-113) — what the create/edit
    // flow calls on every "Generate"/"Refresh preview" click.
    generate: (dsl_source: string) => request<{ plan: RunPlan; warnings: ParseWarning[] }>("/api/v1/plan-templates/generate", "POST", undefined, { dsl_source }),
    // HRA-326: backend-composed "Plan text -> RunPlan DSL" conversion prompt
    // preview, replacing the frontend's own local prompt-template asset —
    // the same composeConversionPrompt() call a future real AI provider call
    // will use, so preview and the actual send can never drift. Every
    // context field is optional.
    composePrompt: (text: string, context: { language?: string; event?: EventType; event_name?: string; distance_m?: number; unit?: "km" | "mi" } = {}) =>
      request<{ prompt: string }>("/api/v1/plan-templates/prompt-preview", "POST", undefined, { text, ...context }),
    // HRA-329: the real, billable "Genera DSL con AI" call — same context
    // shape as composePrompt above (the backend composes the identical
    // prompt), but actually sends it to the configured provider and returns
    // the generated DSL text instead of the prompt itself. Never persists.
    generateDsl: (text: string, context: { language?: string; event?: EventType; event_name?: string; distance_m?: number; unit?: "km" | "mi" } = {}) =>
      request<{ dsl: string; model: string; generated_at: string }>("/api/v1/plan-templates/ai-generate", "POST", undefined, { text, ...context }),
    // event/distance_m (HRA-120): explicit request fields, replacing the old
    // DSL-text EVENT/DISTANCE lines — distance_m only meaningful (and only
    // sent) when event is "custom".
    create: (name: string, event: EventType, dsl_source: string, distance_m?: number) =>
      request<PlanTemplate>("/api/v1/plan-templates", "POST", undefined, { name, event, distance_m, dsl_source }),
    update: (id: number, name: string, event: EventType, dsl_source: string, distance_m?: number) =>
      request<PlanTemplate>(`/api/v1/plan-templates/${id}`, "PUT", undefined, { name, event, distance_m, dsl_source }),
    approve: (id: number) => request<PlanTemplate>(`/api/v1/plan-templates/${id}/approve`, "POST"),
    remove: (id: number) => request<null>(`/api/v1/plan-templates/${id}`, "DELETE"),
    // POST /api/v1/plan-templates/:id/instantiate (HRA-112/HRA-113/HRA-114) —
    // pace_overrides is {anchor: "pace string"}, same grammar as a PACE
    // line's right-hand side; goal_time is an alternate input for whichever
    // anchor race_pace_anchor names (HRA-121 — required whenever goal_time is
    // supplied, no default). race_name/race_date (HRA-121) are independent of
    // target_activity_id.
    instantiate: (templateId: number, body: {
      name: string; start_date: string; pace_overrides?: Record<string, string>;
      goal_time?: string; race_pace_anchor?: string; distance_m?: number; target_activity_id?: number | null;
      race_name?: string; race_date?: string; race_url?: string; rest_day_label?: string;
    }) => request<PlanInstanceWithDays>(`/api/v1/plan-templates/${templateId}/instantiate`, "POST", undefined, body),
    // GET /api/v1/plan-templates/:id/mobile-eligibility (HRA-302) — read-only
    // structural check feeding the mobile simplified race-plan creation
    // entry point. race_pace_anchor is the one anchor a goal time must
    // resolve, or null when either no anchor is needed or the template isn't
    // eligible (see reason).
    mobileEligibility: (templateId: number) => request<{
      eligible: boolean; race_pace_anchor: string | null; distance_m: number | null;
      reason: "already-resolved" | "ambiguous-anchors" | "unresolvable" | null;
    }>(`/api/v1/plan-templates/${templateId}/mobile-eligibility`, "GET"),
    // POST /api/v1/plan-templates/:id/instantiate/preview (HRA-302) — same
    // goal_time -> pace conversion as instantiate above, but never persists.
    // Feeds the mobile review step's derived start date + resolved paces.
    instantiatePreview: (templateId: number, body: {
      start_date: string; goal_time?: string; race_pace_anchor?: string; distance_m?: number; rest_day_label?: string;
    }) => request<{
      start_date: string; race_pace_anchor: string | null; resolved_paces: Record<string, number>; needs_review: boolean;
    }>(`/api/v1/plan-templates/${templateId}/instantiate/preview`, "POST", undefined, body),
  },
  planInstances: {
    // template_id is optional — HRA-118's own list card can show all
    // instances or scope to one template (the GET .../plan-instances list
    // route was added this Story — no prior endpoint returned a collection).
    list: async (templateId?: number) => (await request<Paginated<PlanInstance>>(
      "/api/v1/plan-instances", "GET", templateId != null ? { limit: ALL, template_id: String(templateId) } : { limit: ALL },
    )).data,
    getById: (id: number) => request<PlanInstanceWithDays>(`/api/v1/plan-instances/${id}`),
    // GET /api/v1/plan-instances/active?date= (HRA-248) — "Your agenda"'s
    // today-centered home view. The endpoint 404s when no APPROVED
    // instance's resolved days cover `date` — translated to `null` here
    // (not rethrown) so useQuery's "success" branch can distinguish "no
    // active plan" (null) from a genuine fetch failure (still throws,
    // reaching useQuery's own "error" branch), same "expected absence isn't
    // an error" reasoning `PlanInstanceCalendar`'s own 404 paths don't need
    // since they're id-addressed, not existence-queried.
    active: async (date: string): Promise<PlanInstanceWithDays | null> => {
      try {
        return await request<PlanInstanceWithDays>("/api/v1/plan-instances/active", "GET", { date });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    // PATCH /api/v1/plan-instances/:id (HRA-135, replacing the earlier PUT) —
    // every field optional, at least one required; each provided field
    // replaces its current value, omitted fields stay untouched. `days`, when
    // provided, is {section_name, week_number, date, dsl, workout_id?}
    // (HRA-115, workout_id HRA-333) — raw DSL text, re-parsed and resolved
    // server-side against that day's own effective pace policy, and still
    // fully replaces the day set. workout_id, when echoed back for a day
    // this instance already had, preserves that workout's stable identity
    // across the replace (see docs/schema.md) — omitted for a genuinely new
    // day.
    update: (id: number, body: Partial<{
      name: string; race_name: string | null; race_date: string | null; race_url: string | null;
      days: { section_name: string; week_number: number; date: string; dsl: string; workout_id?: string }[];
    }>) => request<PlanInstanceWithDays>(`/api/v1/plan-instances/${id}`, "PATCH", undefined, body),
    approve: (id: number) => request<PlanInstance>(`/api/v1/plan-instances/${id}/approve`, "POST"),
    // POST /api/v1/plan-instances/:id/regenerate (HRA-132/HRA-134) —
    // effective_from is required (server-floored to today, never trusted
    // client-side alone); start_date/pace_overrides each fall back to the
    // instance's own current value when omitted server-side, but this app
    // always sends both explicitly (the editor's own live values). Returns
    // the updated instance with its regenerated days, same shape update()
    // above returns.
    // HRA-299: confirm_overwrite is required (true) once the server-side
    // preflight finds a customized day in range — see the 409 handling in
    // PlanInstancesSection.tsx's doRegenerate.
    regenerate: (id: number, body: { start_date: string; pace_overrides?: Record<string, string>; effective_from: string; confirm_overwrite?: boolean }) =>
      request<PlanInstanceWithDays>(`/api/v1/plan-instances/${id}/regenerate`, "POST", undefined, body),
    remove: (id: number) => request<null>(`/api/v1/plan-instances/${id}`, "DELETE"),
    // PATCH /api/v1/plan-instances/:id/days/:dayId (HRA-149) — a single day's
    // dsl/notes/scheduled_time, persisted independently of the bulk `update`
    // above (which fully replaces the day set and never backfills
    // scheduled_time — see that endpoint's own doc comment). HRA-150 uses
    // this exclusively for scheduled_time, so a day edit persists immediately
    // rather than waiting for the whole-day bulk Save.
    // workout_id (HRA-333, optional) moves this row's stable identity onto
    // the content it now holds. No longer used by the swap flows — see
    // swapWorkouts below.
    patchDay: (instanceId: number, dayId: number, body: Partial<{ dsl: string; notes: string | null; scheduled_time: string | null; workout_id: string }>) =>
      request<PlanInstanceDay>(`/api/v1/plan-instances/${instanceId}/days/${dayId}`, "PATCH", undefined, body),
    // POST /api/v1/plan-instances/:id/workouts/swap (HRA-333 follow-up) — one
    // atomic exchange of which logical workout occupies each of the two
    // given calendar slots (both plan_instance_days ids). Replaces the old
    // two-call PATCH .../days/:dayId workaround (each call its own
    // transaction, each echoing the other's workout_id — never actually
    // atomic, and could violate the backend's deferred uniqueness constraint
    // at commit; see docs/architecture/POSTGRESQL-MIGRATION.md). Neither
    // day's own id/date/scheduled_time moves, and each workout's own
    // content/customization/activity associations follow its workout_id, not
    // the slot — so the caller no longer needs to resend dsl at all.
    swapWorkouts: (instanceId: number, dayAId: number, dayBId: number) =>
      request<{ day_a: PlanInstanceDay; day_b: PlanInstanceDay }>(
        `/api/v1/plan-instances/${instanceId}/workouts/swap`, "POST", undefined, { day_a_id: dayAId, day_b_id: dayBId },
      ),
    // POST /api/v1/plan-instances/:id/days/:dayId/validate (HRA-162) —
    // parse-only preview, never persists (mirrors planTemplates.generate's
    // own preview-vs-persist split above). What List view's per-day editor
    // calls, debounced, on every DSL keystroke so warning feedback updates
    // live instead of only after the whole-day bulk Save. Live follow-up:
    // when the parse itself succeeds, the response also carries the
    // resolved workout_type/segments/activity_target/activity_description
    // (all optional — omitted when needs_review is true, i.e. the parse
    // failed) so the caller can compute this day's own distance client-side
    // without persisting.
    validateDay: (instanceId: number, dayId: number, dsl: string) =>
      request<{
        needs_review: boolean; warnings: ParseWarning[];
        workout_type?: WorkoutType; segments?: ResolvedSegment[];
        activity_target?: Target | null; activity_description?: string | null;
      }>(`/api/v1/plan-instances/${instanceId}/days/${dayId}/validate`, "POST", undefined, { dsl }),
    // GET /api/v1/plan-instance-days?date= (HRA-206) — every run-type day
    // matching a calendar date, across every instance. What
    // ActivityDetailBody calls for a running activity to find same-day
    // scheduled workouts; a plain array (possibly empty), no envelope.
    byDate: (date: string) => request<PlanInstanceDayWithInstance[]>("/api/v1/plan-instance-days", "GET", { date }),
    // GET /api/v1/plan-instances/:id/reports/workouts/:workoutId (HRA-336) —
    // the single-workout/race report. workoutId is the stable HRA-333
    // identity, not a plan_instance_days row id.
    workoutReport: (instanceId: number, workoutId: string) =>
      request<WorkoutReport>(`/api/v1/plan-instances/${instanceId}/reports/workouts/${encodeURIComponent(workoutId)}`),
    // PUT/DELETE .../reports/workouts/:workoutId/quality-alignment/:segmentIndex
    // (HRA-342) — confirm/correct/replace or remove a runner's manual
    // structured-quality-workout segment alignment. activityId must already
    // be accepted evidence for this workout (422 otherwise).
    setQualityAlignment: (instanceId: number, workoutId: string, segmentIndex: number, activityId: number, distanceM: number | null, durationSec: number | null) =>
      request(`/api/v1/plan-instances/${instanceId}/reports/workouts/${encodeURIComponent(workoutId)}/quality-alignment/${segmentIndex}`, "PUT", undefined, {
        activity_id: activityId, distance_m: distanceM, duration_sec: durationSec,
      }),
    removeQualityAlignment: (instanceId: number, workoutId: string, segmentIndex: number) =>
      request(`/api/v1/plan-instances/${instanceId}/reports/workouts/${encodeURIComponent(workoutId)}/quality-alignment/${segmentIndex}`, "DELETE"),
    // GET /api/v1/plan-instances/:id/reports/weeks (HRA-338) — the week
    // report, addressed by its own structural slot (section_name +
    // week_number, never a calendar-date span).
    weekReport: (instanceId: number, sectionName: string, weekNumber: number, range: ReportRangeMode = "plan_to_date") =>
      request<WeekReport>(`/api/v1/plan-instances/${instanceId}/reports/weeks`, "GET", {
        section_name: sectionName, week_number: String(weekNumber), range,
      }),
    // GET /api/v1/plan-instances/:id/reports/plan (HRA-338) — the
    // entire-plan report, grouped by week.
    planReport: (instanceId: number, range: ReportRangeMode = "plan_to_date") =>
      request<PlanReport>(`/api/v1/plan-instances/${instanceId}/reports/plan`, "GET", { range }),
    // GET /api/v1/plan-instances/:id/days/:dayId/fit (HRA-202) — a binary
    // FIT file, not JSON, so this bypasses the shared request() helper (its
    // unconditional res.json() would choke on the body). Mirrors
    // buildApiError's own problem+json handling for a non-OK response (422
    // when the day is needs_review or its workout_type isn't run/rest, 429
    // when it would exceed the caller's FIT export allowance — HRA-391) so
    // the caller gets the same human-readable ApiError message every other
    // endpoint throws. Filename comes from the response's own
    // Content-Disposition header, not recomputed client-side, so the two
    // never drift. POST, not GET (HRA-391 moved this off GET): a successful
    // call is now a durable side effect (spends an export credit), which a
    // GET must never carry — same manual CSRF attachment request() applies
    // automatically to every other POST.
    downloadDayFit: async (instanceId: number, dayId: number): Promise<{ blob: Blob; filename: string }> => {
      const path = `/api/v1/plan-instances/${instanceId}/days/${dayId}/fit`;
      const headers: Record<string, string> = {};
      if (csrfToken) headers["X-RunsFree-CSRF"] = csrfToken;
      const res = await fetch(new URL(`${BASE}${path}`, window.location.origin), { method: "POST", credentials: "include", headers });
      if (!res.ok) throw await buildApiError(res, path);
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "workout.fit";
      return { blob: await res.blob(), filename };
    },
    // POST /api/v1/plan-instances/:id/fit?section_name=&week_number=
    // (HRA-203, moved off GET to POST HRA-391) — same binary-download bypass
    // of request() and POST/CSRF reasoning as downloadDayFit above.
    // week_number omitted exports the whole section; supplied, one week
    // within it. The skip count can't ride in the (opaque binary) body, so
    // it comes back as X-Export-* response headers instead — the caller
    // uses them to toast how many days were skipped (Story AC3).
    downloadScopeFit: async (instanceId: number, sectionName: string, weekNumber?: number): Promise<{
      blob: Blob; filename: string; total: number; included: number; skipped: number;
    }> => {
      const path = `/api/v1/plan-instances/${instanceId}/fit`;
      const url = new URL(`${BASE}${path}`, window.location.origin);
      url.searchParams.set("section_name", sectionName);
      if (weekNumber != null) url.searchParams.set("week_number", String(weekNumber));
      const headers: Record<string, string> = {};
      if (csrfToken) headers["X-RunsFree-CSRF"] = csrfToken;
      const res = await fetch(url, { method: "POST", credentials: "include", headers });
      if (!res.ok) throw await buildApiError(res, path);
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "workouts.zip";
      return {
        blob: await res.blob(), filename,
        total: Number(res.headers.get("X-Export-Total") ?? "0"),
        included: Number(res.headers.get("X-Export-Included") ?? "0"),
        skipped: Number(res.headers.get("X-Export-Skipped") ?? "0"),
      };
    },
  },
  // GET /api/v1/export-allowance (HRA-391) — the authenticated owner's
  // rolling-window FIT export allowance. The frontend never recomputes the
  // window itself; it always reflects exactly what this returns.
  exportAllowance: {
    status: () => request<ExportAllowanceStatus>("/api/v1/export-allowance"),
  },
  // GET /api/v1/reports/range (HRA-341) — the date-range/race-range report,
  // cross-plan (unlike every report above, which is scoped to one plan
  // instance). A race-range is just a saved date_ranges row's own
  // {from,to}, resolved by the caller before this call — there is no
  // separate race-range client method.
  reports: {
    range: (from: string, to: string, range: ReportRangeMode = "plan_to_date") =>
      request<RangeReport>("/api/v1/reports/range", "GET", { from, to, range }),
  },
  // HRA-327: server-side .txt/.csv/.pdf text extraction — the backend does
  // the actual parsing (pdf.js for PDFs, UTF-8 decode + validation for plain
  // text); this endpoint takes a JSON body (base64 content), not multipart.
  sourceFiles: {
    extract: (input: { fileName: string; sourceType: "txt" | "csv" | "pdf"; contentBase64: string }) =>
      request<SourceExtractionResult>("/api/v1/source-files/extract", "POST", undefined, input),
  },
  publication: {
    status:  () => request<PublicationStatus>("/api/v1/publication"),
    preview: () => request<PublicationPreview>("/api/v1/publication/preview"),
    publish: () => request<PublicationStatus>("/api/v1/publication/publish", "POST"),
    refresh: () => request<PublicationStatus>("/api/v1/publication/refresh", "POST"),
    suspend: () => request<PublicationStatus>("/api/v1/publication/suspend", "POST"),
  },
};
