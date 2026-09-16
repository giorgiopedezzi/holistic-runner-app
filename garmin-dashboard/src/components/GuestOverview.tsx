import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useQuery } from "@/hooks/useQuery";
import { useDocumentHead } from "@/hooks/useDocumentHead";
import { fmtDate, fmtDuration, fmtElevation, fmtKm, fmtPace } from "@/utils/fmt";
import { Empty, LoadingSpinner } from "@/components/ui";
import { type GuestView, guestPath, parseGuestRoute } from "@/routing/guestRoute";

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

interface Props {
  view?: GuestView;
  slug?: string;
  activityId?: string | null;
  reportId?: string | null;
  onNavigateToPlan?: () => void;
  onNavigateToJourney?: () => void;
  onNavigateToActivity?: (publicId: string | null) => void;
  onNavigateToReport?: (publicId: string | null) => void;
  onSignIn?: () => void;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function readPublic<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<T>;
}

async function loadGuestData(slug: string): Promise<GuestData> {
  const base = `/api/v1/public/profiles/${encodeURIComponent(slug)}`;
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
  selectedPublicId: string | null;
  onSelect: (publicId: string | null) => void;
}

function GuestConversion({ action, description, onSignIn }: { action: string; description: string; onSignIn?: () => void }) {
  const { t } = useTranslation();
  if (!onSignIn) return null;
  return <section className="hra-guest-conversion">
    <p className="hra-label">{t("guest.conversion.eyebrow", "Make it yours")}</p>
    <h2 className="text-heading">{action}</h2>
    <p className="hra-text-secondary text-body">{description}</p>
    <button type="button" className="hra-btn" onClick={onSignIn}>{t("guest.conversion.signIn", "Try Runs Free with your training")}</button>
  </section>;
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

function GuestActivityList({ activities, selectedPublicId, onSelect }: GuestActivityListProps) {
  const { t } = useTranslation();

  return <section className="hra-guest-overview" aria-label={t("guest.activities.label", "Published activities")}>
    <div className="hra-guest-hero"><p className="hra-label">{t("guest.activities.eyebrow", "Published training")}</p><h1 className="hra-section-title">{t("guest.activities.title", "Recent training")}</h1></div>
    {activities.data.length > 0 ? <div className="hra-guest-activity-layout">
      <section className="hra-guest-activity-list" aria-label={t("guest.activities.listLabel", "Published activity history")}>
        {activities.data.map(activity => <button key={activity.publicId} type="button" className="hra-guest-activity-row" onClick={() => onSelect(activity.publicId)} aria-pressed={selectedPublicId === activity.publicId}>
          <span>{stringField(activity.fields, "title") ?? t("guest.overview.publishedActivity", "Published activity")}</span>
          <span className="hra-text-muted text-meta">{stringField(activity.fields, "date") ? fmtDate(stringField(activity.fields, "date")!) : t("guest.activities.dateUnavailable", "Date unavailable")}</span>
          {numberField(activity.fields, "distanceM") != null && <strong>{fmtKm(numberField(activity.fields, "distanceM")!)}</strong>}
        </button>)}
      </section>
      {selectedPublicId && <GuestActivityDetailFetch slug={activities.slug} publicId={selectedPublicId} />}
    </div> : <Empty message={t("guest.activities.unavailable", "No activities have been published.")} />}
  </section>;
}

type DatasetName = "original" | "current" | "actual";

function reportDataset(fields: Fields, name: DatasetName): Fields | null {
  return objectField(objectField(fields, "datasets") ?? {}, name);
}

function DatasetEvidence({ report, name }: { report: PublicItem; name: DatasetName }) {
  const { t } = useTranslation();
  const dataset = reportDataset(report.fields, name);
  const title = name === "original"
    ? t("guest.report.original", "Original plan")
    : name === "current"
      ? t("guest.report.current", "Effective plan")
      : t("guest.report.actual", "Actual activity");
  const empty = name === "original"
    ? t("guest.report.originalUnavailable", "No original plan data was published.")
    : name === "current"
      ? t("guest.report.currentUnavailable", "No effective plan data was published.")
      : t("guest.report.actualUnavailable", "No accepted actual activity was published.");
  const distance = dataset && numberField(dataset, "distanceM");
  const duration = dataset && numberField(dataset, "durationSec");
  const paceSec = dataset && numberField(dataset, "paceSecPerKm");
  const hasMetrics = distance != null || duration != null || paceSec != null;

  return <section className="hra-border rounded-lg p-3 flex flex-col gap-1.5">
    <h3 className="hra-text-secondary text-label">{title}</h3>
    {hasMetrics ? <dl>
      {distance != null && <div className="hra-fact-row"><dt>{t("guest.activity.distance", "Distance")}</dt><dd>{fmtKm(distance)}</dd></div>}
      {duration != null && <div className="hra-fact-row"><dt>{t("guest.activity.duration", "Duration")}</dt><dd>{fmtDuration(duration)}</dd></div>}
      {paceSec != null && <div className="hra-fact-row"><dt>{t("guest.activity.pace", "Average pace")}</dt><dd>{fmtPace(paceSec / 60)}/km</dd></div>}
    </dl> : <p className="hra-text-muted text-meta">{empty}</p>}
  </section>;
}

function GuestReportDetail({ report }: { report: PublicItem }) {
  const { t } = useTranslation();
  const coverage = objectField(report.fields, "coverage");
  const comparisons = objectField(report.fields, "comparisons");
  const generatedAt = stringField(report.fields, "generatedAt") ?? stringField(report.fields, "asOf");
  const comparisonKinds: Array<[string, string]> = [
    ["adaptation", t("guest.report.adaptation", "Planned changes")],
    ["execution", t("guest.report.execution", "Execution")],
    ["outcome", t("guest.report.outcome", "Outcome")],
  ];
  const visibleComparisons = comparisonKinds.filter(([key]) => arrayField(comparisons ?? {}, key).length > 0);

  return <section className="hra-guest-activity-detail" aria-label={t("guest.report.detailLabel", "Published comparison detail")}>
    <div className="hra-guest-hero">
      <p className="hra-label">{t("guest.report.eyebrow", "Published planned-versus-actual evidence")}</p>
      <h2 className="text-heading">{stringField(report.fields, "kind") ?? t("guest.reports.publishedReport", "Published comparison")}</h2>
      {generatedAt && <p className="hra-text-muted text-meta">{t("guest.report.snapshot", `Published ${fmtDate(generatedAt)}. This is a read-only snapshot.`, { generatedAt: fmtDate(generatedAt) })}</p>}
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {(["original", "current", "actual"] as const).map(name => <DatasetEvidence key={name} report={report} name={name} />)}
    </div>
    {coverage ? <section className="hra-bg-card hra-border-strong rounded-xl p-5">
      <h3 className="hra-text-secondary text-label">{t("guest.report.coverage", "Published evidence coverage")}</h3>
      <dl className="hra-guest-facts">
        {numberField(coverage, "trustedActivities") != null && <div className="hra-fact-row"><dt>{t("guest.report.trusted", "Accepted actual activities")}</dt><dd>{numberField(coverage, "trustedActivities")}</dd></div>}
        {numberField(coverage, "ambiguousActivities") != null && <div className="hra-fact-row"><dt>{t("guest.report.unmatched", "Unmatched or ambiguous activities")}</dt><dd>{numberField(coverage, "ambiguousActivities")}</dd></div>}
        {numberField(coverage, "extraActivities") != null && <div className="hra-fact-row"><dt>{t("guest.report.extra", "Unplanned activities")}</dt><dd>{numberField(coverage, "extraActivities")}</dd></div>}
      </dl>
    </section> : <p className="hra-text-muted text-meta">{t("guest.report.coverageUnavailable", "Coverage is not available in this published snapshot.")}</p>}
    <section className="hra-bg-card hra-border-strong rounded-xl p-5">
      <h3 className="hra-text-secondary text-label">{t("guest.report.progress", "Published progress views")}</h3>
      {visibleComparisons.length > 0 ? <ul className="hra-guest-facts">
        {visibleComparisons.map(([key, label]) => <li key={key} className="hra-fact-row"><span>{label}</span><strong>{arrayField(comparisons ?? {}, key).length}</strong></li>)}
      </ul> : <p className="hra-text-muted text-meta">{t("guest.report.progressUnavailable", "No comparable published progress is available for this snapshot.")}</p>}
    </section>
  </section>;
}

function GuestReportDetailFetch({ slug, publicId }: { slug: string; publicId: string }) {
  const { t } = useTranslation();
  const detail = useQuery(
    () => readPublic<PublicResource<PublicItem>>(`/api/v1/public/profiles/${encodeURIComponent(slug)}/reports/${encodeURIComponent(publicId)}`),
    [slug, publicId],
  );
  if (detail.state.status === "loading" || detail.state.status === "idle") return <LoadingSpinner label={t("guest.report.loading", "Loading published comparison…")} />;
  return detail.state.status === "success"
    ? <GuestReportDetail report={detail.state.data.data} />
    : <Empty message={t("guest.report.unavailable", "This published comparison is currently unavailable.")} />;
}

interface GuestReportListProps {
  reports: PublicResource<PublicItem[]>;
  selectedPublicId: string | null;
  onSelect: (publicId: string | null) => void;
}

function GuestReportList({ reports, selectedPublicId, onSelect }: GuestReportListProps) {
  const { t } = useTranslation();
  return <section className="hra-guest-overview" aria-label={t("guest.reports.label", "Published comparisons")}>
    <div className="hra-guest-hero"><p className="hra-label">{t("guest.reports.eyebrow", "Published comparison")}</p><h1 className="hra-section-title">{t("guest.reports.title", "Training progress")}</h1></div>
    {reports.data.length > 0 ? <div className="hra-guest-activity-layout">
      <section className="hra-guest-activity-list" aria-label={t("guest.report.listLabel", "Published planned-versus-actual evidence")}>
        {reports.data.map(report => <button key={report.publicId} type="button" className="hra-guest-activity-row" onClick={() => onSelect(report.publicId)} aria-pressed={selectedPublicId === report.publicId}>
          <span>{stringField(report.fields, "kind") ?? t("guest.reports.publishedReport", "Published comparison")}</span>
          <span className="hra-text-muted text-meta">{stringField(report.fields, "generatedAt") ? fmtDate(stringField(report.fields, "generatedAt")!) : t("guest.reports.available", "Available")}</span>
        </button>)}
      </section>
      {selectedPublicId && <GuestReportDetailFetch slug={reports.slug} publicId={selectedPublicId} />}
    </div> : <Empty message={t("guest.reports.unavailable", "No comparisons have been published.")} />}
  </section>;
}

export function GuestOverview({
  view = "journey", slug, activityId = null, reportId = null,
  onNavigateToPlan, onNavigateToJourney, onNavigateToActivity, onNavigateToReport, onSignIn,
}: Props) {
  const { t } = useTranslation();
  const resolvedSlug = slug ?? parseGuestRoute(window.location.pathname).slug;
  const query = useQuery(() => loadGuestData(resolvedSlug), [resolvedSlug]);

  // Selection stays real internal state — not purely prop-driven — so this
  // component keeps working standalone (its own test suite renders it
  // without a routing parent). The two effects below only pull in an
  // external deep link (GuestShell's parsed URL); a click always notifies
  // the optional callback too, so a routing parent can mirror the choice
  // into the browser URL (HRA-368) without owning the click itself.
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(activityId);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(reportId);
  useEffect(() => { setSelectedActivityId(activityId); }, [activityId]);
  useEffect(() => { setSelectedReportId(reportId); }, [reportId]);
  function selectActivity(id: string | null) {
    setSelectedActivityId(id);
    onNavigateToActivity?.(id);
  }
  function selectReport(id: string | null) {
    setSelectedReportId(id);
    onNavigateToReport?.(id);
  }

  const loaded = query.state.status === "success" ? query.state.data : null;
  const metaFounder = loaded ? displayName(loaded.profile.data) : null;
  const metaBaseTitle = metaFounder
    ? t("guest.overview.titleNamed", `${metaFounder}'s road to the start line`, { founder: metaFounder })
    : loaded
      ? t("guest.overview.title", "A runner's road to the start line")
      : t("guest.title", "Follow the founder journey");
  const metaSection = view === "plan" ? t("guest.plan.eyebrow", "Published current plan")
    : view === "activities" ? (selectedActivityId ? t("guest.overview.publishedActivity", "Published activity") : t("guest.activities.title", "Recent training"))
    : view === "reports" ? (selectedReportId ? t("guest.reports.publishedReport", "Published comparison") : t("guest.reports.title", "Training progress"))
    : null;
  const metaTitle = metaSection ? `${metaBaseTitle} · ${metaSection}` : metaBaseTitle;
  const metaDescription = loaded ? stringField(loaded.profile.data.fields, "bio") : null;
  const canonicalPath = guestPath(resolvedSlug, view, view === "activities" ? selectedActivityId : view === "reports" ? selectedReportId : undefined);
  useDocumentHead({ title: metaTitle, description: metaDescription, canonicalPath });

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
            <GuestConversion
              action={t("guest.conversion.createPlan.title", "Create my plan")}
              description={t("guest.conversion.createPlan.description", "Sign in to create and edit a private training plan. The published founder schedule stays separate from your account.")}
              onSignIn={onSignIn}
            />
            {onNavigateToJourney && <button type="button" className="hra-btn mt-3" onClick={onNavigateToJourney}>{t("guest.plan.backToJourney", "Back to founder journey")}</button>}
          </section>
        </> : <Empty message={t("guest.plan.unavailable", "A current plan has not been published.")} />}
      </section>
    );
  }

  if (view === "activities") {
    return <><GuestActivityList activities={activities} selectedPublicId={selectedActivityId} onSelect={selectActivity} /><GuestConversion
      action={t("guest.conversion.importActivities.title", "Import my activities")}
      description={t("guest.conversion.importActivities.description", "Sign in to connect your own activity sources and keep them private to your account.")}
      onSignIn={onSignIn}
    /></>;
  }

  if (view === "reports") {
    return <><GuestReportList reports={reports} selectedPublicId={selectedReportId} onSelect={selectReport} /><GuestConversion
      action={t("guest.conversion.training.title", "See this with my training")}
      description={t("guest.conversion.training.description", "Sign in to view progress built from your own training, not the founder’s published data.")}
      onSignIn={onSignIn}
    /></>;
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
      <GuestConversion
        action={t("guest.conversion.journey.title", "Start your own running journey")}
        description={t("guest.conversion.journey.description", "Sign in to create a private plan, import activities, and connect your own data.")}
        onSignIn={onSignIn}
      />
    </section>
  );
}
