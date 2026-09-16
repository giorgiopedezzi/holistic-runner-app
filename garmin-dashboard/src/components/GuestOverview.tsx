import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useQuery } from "@/hooks/useQuery";
import { fmtDate, fmtDuration, fmtElevation, fmtKm, fmtPace } from "@/utils/fmt";
import { Empty, LoadingSpinner } from "@/components/ui";

type PublicValue = null | boolean | number | string | PublicValue[] | { [key: string]: PublicValue };
type Fields = Record<string, PublicValue>;
interface PublicResource<T> { slug: string; projectedAt: string; data: T }
interface PublicItem { publicId: string; fields: Fields }
interface GuestData {
  profile: PublicResource<PublicItem>;
  activities: PublicResource<PublicItem[]>;
  plans: PublicResource<PublicItem[]>;
  reports: PublicResource<PublicItem[]>;
}

export type GuestView = "journey" | "plan" | "activities" | "reports";

interface Props {
  view?: GuestView;
  onNavigateToPlan?: () => void;
  onNavigateToJourney?: () => void;
}

const DEFAULT_FOUNDER_SLUG = "founder-journey";
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function publicSlug(): string {
  const match = /^\/p\/([^/]+)\/?$/.exec(window.location.pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : DEFAULT_FOUNDER_SLUG;
}

async function readPublic<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<T>;
}

async function loadGuestData(): Promise<GuestData> {
  const slug = encodeURIComponent(publicSlug());
  const base = `/api/v1/public/profiles/${slug}`;
  const [profile, activities, plans, reports] = await Promise.all([
    readPublic<PublicResource<PublicItem>>(base),
    readPublic<PublicResource<PublicItem[]>>(`${base}/activities`),
    readPublic<PublicResource<PublicItem[]>>(`${base}/plans`),
    readPublic<PublicResource<PublicItem[]>>(`${base}/reports`),
  ]);
  return { profile, activities, plans, reports };
}

function stringField(fields: Fields, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberField(fields: Fields, key: string): number | null {
  const value = fields[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function newestActivity(activities: PublicItem[]): PublicItem | null {
  return activities.reduce<PublicItem | null>((newest, activity) => {
    const date = stringField(activity.fields, "date");
    const newestDate = newest ? stringField(newest.fields, "date") : null;
    return date && (!newestDate || date > newestDate) ? activity : newest;
  }, null);
}

function currentPlan(plans: PublicItem[]): PublicItem | null {
  const today = new Date().toISOString().slice(0, 10);
  return plans.find(plan => {
    const start = stringField(plan.fields, "startDate");
    const race = stringField(plan.fields, "raceDate");
    return (!start || start <= today) && (!race || race >= today);
  }) ?? plans[0] ?? null;
}

function displayName(profile: PublicItem): string | null {
  return stringField(profile.fields, "displayName");
}

function objectField(fields: Fields, key: string): Fields | null {
  const value = fields[key];
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function arrayField(fields: Fields, key: string): Fields[] {
  const value = fields[key];
  return Array.isArray(value) ? value.filter((item): item is Fields => item !== null && typeof item === "object" && !Array.isArray(item)) : [];
}

function weekDates(today = new Date()): string[] {
  const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function workoutLabel(workout: Fields): string | null {
  return stringField(workout, "title") ?? stringField(workout, "name") ?? stringField(workout, "dsl") ?? stringField(workout, "workoutType");
}

function stateLabel(workout: Fields, state: "original" | "current" | "actual"): string | null {
  const value = objectField(workout, state);
  if (value) return workoutLabel(value) ?? stringField(value, "status");
  return stringField(workout, `${state}Label`);
}

interface GuestActivityListProps {
  activities: PublicResource<PublicItem[]>;
}

function GuestActivityDetail({ activity }: { activity: PublicItem }) {
  const { t } = useTranslation();
  const metrics: Array<{ key: string; label: string; value: string | null }> = [
    { key: "distance", label: t("guest.activity.distance", "Distance"), value: numberField(activity.fields, "distanceM") != null ? fmtKm(numberField(activity.fields, "distanceM")!) : null },
    { key: "duration", label: t("guest.activity.duration", "Duration"), value: numberField(activity.fields, "durationSec") != null ? fmtDuration(numberField(activity.fields, "durationSec")!) : null },
    { key: "moving-time", label: t("guest.activity.movingTime", "Moving time"), value: numberField(activity.fields, "movingTimeSec") != null ? fmtDuration(numberField(activity.fields, "movingTimeSec")!) : null },
    { key: "pace", label: t("guest.activity.pace", "Average pace"), value: numberField(activity.fields, "avgPaceMinKm") != null ? `${fmtPace(numberField(activity.fields, "avgPaceMinKm")!)}/km` : null },
    { key: "average-hr", label: t("guest.activity.averageHr", "Average heart rate"), value: numberField(activity.fields, "avgHr") != null ? `${numberField(activity.fields, "avgHr")} bpm` : null },
    { key: "max-hr", label: t("guest.activity.maxHr", "Maximum heart rate"), value: numberField(activity.fields, "maxHr") != null ? `${numberField(activity.fields, "maxHr")} bpm` : null },
    { key: "cadence", label: t("guest.activity.cadence", "Cadence"), value: numberField(activity.fields, "avgCadence") != null ? `${numberField(activity.fields, "avgCadence")} spm` : null },
    { key: "ascent", label: t("guest.activity.ascent", "Ascent"), value: numberField(activity.fields, "ascentM") != null ? fmtElevation(numberField(activity.fields, "ascentM")!) : null },
    { key: "descent", label: t("guest.activity.descent", "Descent"), value: numberField(activity.fields, "descentM") != null ? fmtElevation(numberField(activity.fields, "descentM")!) : null },
    { key: "calories", label: t("guest.activity.calories", "Calories"), value: numberField(activity.fields, "calories") != null ? `${numberField(activity.fields, "calories")} kcal` : null },
  ];
  const publishedMetrics = metrics.filter(metric => metric.value != null);
  const track = arrayField(activity.fields, "track");

  return <section className="hra-guest-activity-detail" aria-label={t("guest.activity.detailLabel", "Published activity detail")}>
    <div className="hra-guest-hero">
      <p className="hra-label">{t("guest.activity.eyebrow", "Published activity")}</p>
      <h2 className="text-heading">{stringField(activity.fields, "title") ?? t("guest.overview.publishedActivity", "Published activity")}</h2>
      {stringField(activity.fields, "date") && <p className="hra-text-muted text-meta">{fmtDate(stringField(activity.fields, "date")!)}</p>}
    </div>
    {publishedMetrics.length > 0 ? <dl className="hra-guest-activity-metrics">
      {publishedMetrics.map(metric => <div key={metric.key} className="hra-fact-row"><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}
    </dl> : <p className="hra-text-secondary text-body">{t("guest.activity.metricsUnavailable", "Published metrics are unavailable for this activity.")}</p>}
    {track.length > 0 && <p className="hra-text-muted text-meta">{t("guest.activity.trackAvailable", "Recorded activity-series data is available in this published snapshot.")}</p>}
  </section>;
}

function GuestActivityDetailFetch({ slug, publicId }: { slug: string; publicId: string }) {
  const { t } = useTranslation();
  const detail = useQuery(
    () => readPublic<PublicResource<PublicItem>>(`/api/v1/public/profiles/${encodeURIComponent(slug)}/activities/${encodeURIComponent(publicId)}`),
    [slug, publicId],
  );
  if (detail.state.status === "loading" || detail.state.status === "idle") {
    return <LoadingSpinner label={t("guest.activity.loading", "Loading published activity…")} />;
  }
  return detail.state.status === "success"
    ? <GuestActivityDetail activity={detail.state.data.data} />
    : <Empty message={t("guest.activity.unavailable", "This published activity is currently unavailable.")} />;
}

function GuestActivityList({ activities }: GuestActivityListProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<PublicItem | null>(null);

  return <section className="hra-guest-overview" aria-label={t("guest.activities.label", "Published activities")}>
    <div className="hra-guest-hero"><p className="hra-label">{t("guest.activities.eyebrow", "Published training")}</p><h1 className="hra-section-title">{t("guest.activities.title", "Recent training")}</h1></div>
    {activities.data.length > 0 ? <div className="hra-guest-activity-layout">
      <section className="hra-guest-activity-list" aria-label={t("guest.activities.listLabel", "Published activity history")}>
        {activities.data.map(activity => <button key={activity.publicId} type="button" className="hra-guest-activity-row" onClick={() => setSelected(activity)} aria-pressed={selected?.publicId === activity.publicId}>
          <span>{stringField(activity.fields, "title") ?? t("guest.overview.publishedActivity", "Published activity")}</span>
          <span className="hra-text-muted text-meta">{stringField(activity.fields, "date") ? fmtDate(stringField(activity.fields, "date")!) : t("guest.activities.dateUnavailable", "Date unavailable")}</span>
          {numberField(activity.fields, "distanceM") != null && <strong>{fmtKm(numberField(activity.fields, "distanceM")!)}</strong>}
        </button>)}
      </section>
      {selected && <GuestActivityDetailFetch slug={activities.slug} publicId={selected.publicId} />}
    </div> : <Empty message={t("guest.activities.unavailable", "No activities have been published.")} />}
  </section>;
}

export function GuestOverview({ view = "journey", onNavigateToPlan, onNavigateToJourney }: Props) {
  const { t } = useTranslation();
  const query = useQuery(loadGuestData, []);

  if (query.state.status === "loading" || query.state.status === "idle") {
    return <LoadingSpinner label={t("guest.overview.loading", "Loading the published journey…")} />;
  }
  if (query.state.status === "error") {
    return <Empty message={t("guest.overview.unavailable", "This published journey is currently unavailable.")} />;
  }

  const { profile, activities, plans, reports } = query.state.data;
  const founder = displayName(profile.data);
  const plan = currentPlan(plans.data);
  const latest = newestActivity(activities.data);
  const planName = plan ? stringField(plan.fields, "name") : null;
  const raceName = plan ? stringField(plan.fields, "raceName") ?? stringField(plan.fields, "event") : null;
  const raceDate = plan ? stringField(plan.fields, "raceDate") : null;
  const latestDate = latest ? stringField(latest.fields, "date") : null;
  const latestTitle = latest ? stringField(latest.fields, "title") : null;
  const latestDistance = latest ? numberField(latest.fields, "distanceM") : null;
  const latestDuration = latest ? numberField(latest.fields, "movingTimeSec") ?? numberField(latest.fields, "durationSec") : null;
  const latestPace = latest ? numberField(latest.fields, "avgPaceMinKm") : null;
  const projectedAt = profile.projectedAt;

  if (view === "plan") {
    const workouts = plan ? arrayField(plan.fields, "workouts") : [];
    const byDate = new Map(workouts.map(workout => [stringField(workout, "date"), workout]));
    return (
      <section className="hra-guest-overview" aria-label={t("guest.plan.label", "Published current plan")}>
        <div className="hra-guest-hero">
          <p className="hra-label">{t("guest.plan.eyebrow", "Published current plan")}</p>
          <h1 className="hra-section-title">{planName ?? t("guest.plan.untitled", "Current training plan")}</h1>
          {raceName && <p className="hra-text-secondary text-body">{raceName}</p>}
          {raceDate && <p className="hra-text-muted text-meta">{t("guest.overview.targetDate", `Target: ${fmtDate(raceDate)}`, { date: fmtDate(raceDate) })}</p>}
          <p className="hra-text-muted text-meta">{t("guest.plan.snapshot", `Published ${fmtDate(projectedAt)}. Schedule changes appear in the next snapshot.`, { projectedAt: fmtDate(projectedAt) })}</p>
        </div>
        {plan ? <>
          <section className="hra-bg-card hra-border-strong rounded-xl p-5">
            <p className="hra-label">{t("guest.plan.currentWeek", "Current week")}</p>
            <ol className="hra-guest-week" aria-label={t("guest.plan.currentWeekLabel", "Current training week")}>
              {weekDates().map(date => {
                const workout = byDate.get(date);
                const type = workout ? stringField(workout, "workoutType") : null;
                const unsupported = type === "unsupported" || type === "other" || workout?.unsupported === true;
                return <li key={date} className="hra-guest-week-day">
                  <span className="hra-guest-week-date">{fmtDate(date)}</span>
                  {!workout ? <span>{t("guest.plan.notPublished", "No workout published")}</span>
                    : type === "rest" ? <span>{t("guest.plan.rest", "Rest day")}</span>
                    : unsupported ? <span>{t("guest.plan.unsupported", "Published workout details are unavailable")}</span>
                    : <span>{workoutLabel(workout) ?? t("guest.plan.workout", "Published workout")}</span>}
                  {workout && <span className="hra-guest-week-states">
                    {(["original", "current", "actual"] as const).map(state => {
                      const label = stateLabel(workout, state);
                      const stateName = state === "original"
                        ? t("guest.plan.original", "Original")
                        : state === "current"
                          ? t("guest.plan.current", "Current")
                          : t("guest.plan.actual", "Actual");
                      return label ? <span key={state}>{stateName}: {label}</span> : null;
                    })}
                  </span>}
                </li>;
              })}
            </ol>
          </section>
          <section className="hra-guest-next">
            <h2 className="text-heading">{t("guest.plan.readOnlyTitle", "A read-only published schedule")}</h2>
            <p className="hra-text-secondary text-body">{t("guest.plan.readOnlyDescription", "This view reflects the founder’s effective plan. Editing, swapping, export, and sync controls are available only after sign-in.")}</p>
            {onNavigateToJourney && <button type="button" className="hra-btn mt-3" onClick={onNavigateToJourney}>{t("guest.plan.backToJourney", "Back to founder journey")}</button>}
          </section>
        </> : <Empty message={t("guest.plan.unavailable", "A current plan has not been published.")} />}
      </section>
    );
  }

  if (view === "activities") {
    return <GuestActivityList activities={activities} />;
  }

  if (view === "reports") {
    return <section className="hra-guest-overview" aria-label={t("guest.reports.label", "Published comparisons")}>
      <div className="hra-guest-hero"><p className="hra-label">{t("guest.reports.eyebrow", "Published comparison")}</p><h1 className="hra-section-title">{t("guest.reports.title", "Training progress")}</h1></div>
      {reports.data.length > 0 ? <section className="hra-bg-card hra-border-strong rounded-xl p-5"><div className="hra-guest-facts">
        {reports.data.map(report => <div key={report.publicId} className="hra-fact-row"><span>{stringField(report.fields, "kind") ?? t("guest.reports.publishedReport", "Published comparison")}</span><strong>{stringField(report.fields, "generatedAt") ? fmtDate(stringField(report.fields, "generatedAt")!) : t("guest.reports.available", "Available")}</strong></div>)}
      </div></section> : <Empty message={t("guest.reports.unavailable", "No comparisons have been published.")} />}
    </section>;
  }

  return (
    <section className="hra-guest-overview" aria-label={t("guest.overview.label", "Founder journey overview")}>
      <div className="hra-guest-hero">
        <p className="hra-label">{t("guest.overview.eyebrow", "Published journey")}</p>
        <h1 className="hra-section-title">{founder
          ? t("guest.overview.titleNamed", `${founder}'s road to the start line`, { founder })
          : t("guest.overview.title", "A runner's road to the start line")}</h1>
        {stringField(profile.data.fields, "bio") && <p className="hra-text-secondary text-body max-w-2xl">{stringField(profile.data.fields, "bio")}</p>}
        <p className="hra-text-muted text-meta">{t("guest.overview.publishedAt", `Published ${fmtDate(projectedAt)}. This is a snapshot, not live tracking.`, { projectedAt: fmtDate(projectedAt) })}</p>
      </div>

      <div className="hra-guest-overview-grid">
        <section className="hra-bg-card hra-border-strong rounded-xl p-5">
          <p className="hra-label">{t("guest.overview.currentGoal", "Current goal")}</p>
          {planName || raceName ? <>
            <h2 className="text-heading">{planName ?? raceName}</h2>
            {raceName && planName && <p className="hra-text-secondary text-body">{raceName}</p>}
            {raceDate && <p className="hra-text-muted text-meta">{t("guest.overview.targetDate", `Target: ${fmtDate(raceDate)}`, { date: fmtDate(raceDate) })}</p>}
          </> : <p className="hra-text-secondary text-body">{t("guest.overview.goalUnavailable", "A current target has not been published.")}</p>}
        </section>

        <section className="hra-bg-card hra-border-strong rounded-xl p-5">
          <p className="hra-label">{t("guest.overview.latestTraining", "Latest training")}</p>
          {latest ? <>
            <h2 className="text-heading">{latestTitle ?? t("guest.overview.publishedActivity", "Published activity")}</h2>
            {latestDate && <p className="hra-text-secondary text-body">{fmtDate(latestDate)}</p>}
            <div className="hra-guest-metrics">
              {latestDistance != null && <span>{fmtKm(latestDistance)}</span>}
              {latestDuration != null && <span>{fmtDuration(latestDuration)}</span>}
              {latestPace != null && <span>{fmtPace(latestPace)}/km</span>}
            </div>
          </> : <p className="hra-text-secondary text-body">{t("guest.overview.trainingUnavailable", "No recent training has been published.")}</p>}
        </section>
      </div>

      <section className="hra-bg-card hra-border-strong rounded-xl p-5">
        <p className="hra-label">{t("guest.overview.trustedSignals", "Published signals")}</p>
        <div className="hra-guest-facts">
          <div className="hra-fact-row"><span>{t("guest.overview.activities", "Activities shared")}</span><strong>{activities.data.length}</strong></div>
          <div className="hra-fact-row"><span>{t("guest.overview.currentPlan", "Current plan")}</span><strong>{planName ?? t("guest.overview.unavailableShort", "Unavailable")}</strong></div>
          <div className="hra-fact-row"><span>{t("guest.overview.progressEvidence", "Progress evidence")}</span><strong>{reports.data.length > 0 ? t("guest.overview.available", "Available") : t("guest.overview.unavailableShort", "Unavailable")}</strong></div>
        </div>
      </section>

      <section className="hra-guest-next">
        <h2 className="text-heading">{t("guest.overview.exploreTitle", "Explore the journey")}</h2>
        <p className="hra-text-secondary text-body">{t("guest.overview.exploreDescription", "Public plan, activity, and progress views will appear here as they are published.")}</p>
        {plan && onNavigateToPlan && <button type="button" className="hra-btn mt-3" onClick={onNavigateToPlan}>{t("guest.overview.viewPlan", "View current plan")}</button>}
      </section>
    </section>
  );
}
