import { useTranslation } from "react-i18next";
import { useQuery } from "@/hooks/useQuery";
import { fmtDate, fmtDuration, fmtKm, fmtPace } from "@/utils/fmt";
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

export function GuestOverview() {
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
      </section>
    </section>
  );
}
