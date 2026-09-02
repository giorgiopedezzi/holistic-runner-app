import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { useDateRange } from "@/hooks/useDateRange";
import { useCompareRange } from "@/hooks/useCompareRange";
import { useAppearance } from "@/hooks/useAppearance";
import { useUrlState } from "@/hooks/useUrlState";
import { useQuery } from "@/hooks/useQuery";
import { api } from "@/api/client";
import { SettingsProvider } from "@/hooks/useSettings";
import { DateRangeBar } from "@/components/DateRangeBar";
import { Select, ToastContainer } from "@/components/ui";
import { fmtRaceLabel } from "@/utils/fmt";
import { OverviewTab }  from "@/components/OverviewTab";
import { ActivitiesTab } from "@/components/ActivitiesTab";
import { BodyTab }      from "@/components/BodyTab";
import { PlansTab }     from "@/components/PlansTab";
import { ManageTab }    from "@/components/ManageTab";
import { SettingsTab }  from "@/components/SettingsTab";
import { FeedbackTab }  from "@/components/FeedbackTab";
import { LanguagePicker } from "@/components/LanguagePicker";
import { SplashScreen }  from "@/components/SplashScreen";
import { ErrorBanner }  from "@/components/ui";

// labelKey/fallback: the header nav bar's own strings are the one concrete
// pipeline example proving i18n end to end (HRA-104) — fallback is the
// pre-existing English literal, used as t()'s defaultValue so nothing flashes
// a bare translation key before the backend bundle loads.
const TABS = [
  { id: "overview",    labelKey: "nav.overview",   fallback: "Overview & Trends" },
  { id: "activities",  labelKey: "nav.activities", fallback: "Activities"        },
  { id: "plans",       labelKey: "nav.trainingPlans", fallback: "Plans" },
  { id: "body",        labelKey: "nav.body",       fallback: "Body"              },
  { id: "manage",      labelKey: "nav.manage",     fallback: "Data & Sync"       },
  { id: "settings",    labelKey: "nav.settings",   fallback: "Settings"          },
  { id: "feedback",    labelKey: "nav.feedback",   fallback: "Feedback"          },
] as const;

type TabId = typeof TABS[number]["id"];

// Manage tab doesn't need the global date bar to be the primary control
const TABS_WITH_DATERANGE: TabId[] = ["overview", "activities", "body"];

// Stable (module-scope) URL-key objects for the two global ranges (HRA-196)
// — a fresh object literal passed inline on every render would defeat the
// hooks' internal referential-equality dependency arrays.
const RANGE_URL_KEYS = { from: "from", to: "to" };
const COMPARE_URL_KEYS = { from: "compareFrom", to: "compareTo", enabled: "compareEnabled" };

// SettingsProvider wraps AppShell (not the other way in-line) so every hook
// below it — including useAppearance(), called inside AppShell's own body —
// is a descendant of the provider and shares its one settings fetch.
export default function App() {
  return (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  );
}

function AppShell() {
  // Backed by the URL's `from`/`to` params (HRA-196) so reloading a URL
  // carrying a specific range reproduces it instead of resetting to the
  // 30-day default.
  const range = useDateRange(30, RANGE_URL_KEYS);
  // Only meaningful on the Overview & Trends tab (the only consumer of a
  // "compare to" range), but created here rather than inside OverviewTab so
  // DateRangeBar — rendered once, above the tab content, shared across tabs
  // — can host its pickers. Passed to DateRangeBar/OverviewTab only while
  // tab === "overview" below; the hook itself is cheap to keep alive
  // regardless of which tab is active. Backed by the URL's `compareFrom`/
  // `compareTo`/`compareEnabled` params (HRA-196), same reasoning as `range`.
  const compareRange = useCompareRange(range.from, range.to, COMPARE_URL_KEYS);
  // Named-range dropdown (DateRangeBar) — fetched once here, at the shell
  // level, so it's available to Activities/Body's bar below without each
  // tab fetching its own copy. AppShell itself never unmounts, unlike a
  // per-tab component, so this is a single fetch for the whole session
  // rather than a refetch on every tab switch.
  const savedRangesQ = useQuery(() => api.dateRanges.list(), []);
  const savedRanges = savedRangesQ.state.status === "success" ? savedRangesQ.state.data : [];
  // Race picker (DateRangeBar, Activities tab only) — fetched here for the
  // same reason as savedRanges above: AppShell never unmounts, so this is
  // one fetch for the whole session rather than a refetch per tab switch,
  // even though only the Activities branch below ever renders the picker.
  const racesQ = useQuery(() => api.garmin.races(), []);
  const races = racesQ.state.status === "success" ? racesQ.state.data : [];
  const appearance = useAppearance();
  const { t } = useTranslation();
  // Backed by the URL's `tab` param (HRA-193) so a refresh or a direct link
  // lands on the same tab instead of bouncing back to Overview. An unknown
  // or missing value falls back to Overview here (not inside useUrlState,
  // which stays a generic string primitive with no knowledge of TabId).
  const [rawTab, setTab] = useUrlState("tab", "overview");
  const tab: TabId = TABS.some(tabDef => tabDef.id === rawTab) ? (rawTab as TabId) : "overview";
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/v1/range")
      .then(() => setOnline(true))
      .catch(() => setOnline(false));
  }, []);

  const showDateRange = TABS_WITH_DATERANGE.includes(tab as typeof TABS_WITH_DATERANGE[number]);

  // Activities-only "pick a race" control — jumps from/to to that race's own
  // single day, the same mechanic the named-range Select above it already
  // uses. NO_RACE mirrors DateRangeBar's own NO_NAMED_RANGE sentinel.
  const NO_RACE = "";
  const currentRaceId = races.find(r => r.date_only === range.from && range.from === range.to)?.id;
  // "— none —" actively resets to the default 30-day window rather than
  // being a no-op — see DateRangeBar.tsx's pickCurrent/pickCompare for the
  // same fix and its rationale.
  function pickRace(idStr: string) {
    if (idStr === NO_RACE) { range.setPreset(30); return; }
    const r = races.find(x => String(x.id) === idStr);
    if (r) { range.setFrom(r.date_only); range.setTo(r.date_only); }
  }
  const racePicker = (
    <Select
      value={currentRaceId != null ? String(currentRaceId) : NO_RACE}
      onValueChange={pickRace}
      placeholder={t("dateRange.pickRace", "Pick a race…")}
      triggerClassName="hra-select-grow"
      options={[
        { value: NO_RACE, label: t("dateRange.noneOption", "— none —") },
        ...races.map(r => ({ value: String(r.id), label: fmtRaceLabel(r) })),
      ]}
    />
  );

  return (
    <>
      {/* HRA-223: mounted once at the top of AppShell, gating the rest of
          the UI until dismissed (skip or autoplay finish) — self-contained,
          reads/writes its own sessionStorage flag. */}
      <SplashScreen />
      <div className="min-h-screen flex flex-col">
      {/* Ambient glow is a pure body::before (index.css) now — no JS-rendered
          layer here (correction pass). */}

      {/* ── header ───────────────────────────────────────────────────── */}
      {/* Single compact row now — the date-range controls moved into
          <main> (below), left-aligned above the tab content, instead of
          living in the header. Header keeps a little breathing room
          (.hra-header's padding) rather than shrinking to the bare minimum.
          `.hra-header-inner` still shares <main>'s own maxWidth/padding
          (1240px, 24px — widened from 860px per the graph-first reorg, so
          the main trend graph has real room to breathe) so the nav tabs
          land in the same columns as the content below — the header bar
          itself stays full-bleed (background/blur/border), only its content
          is column-aligned. */}
      <header className="hra-header">
        <div className="hra-header-inner">
          <div className="hra-header-row">
            <span className="hra-brand">Garmin Stats</span>

            {online !== null && (
              <span
                className="hra-status-dot"
                data-online={online}
                title={online ? t("app.serverConnected", "Data service ready") : t("app.serverOffline", "Server offline")}
              />
            )}

            <nav className="hra-nav">
              {TABS.map(tabDef => (
                <button
                  key={tabDef.id}
                  className={[
                    "hra-pill", "hra-nav-pill", "hra-nav-hover",
                    tabDef.id === "manage" ? "hra-nav-manage" : "",
                    tab === tabDef.id ? "hra-pill-active" : "",
                  ].filter(Boolean).join(" ")}
                  data-active={tabDef.id === "manage" ? tab === tabDef.id : undefined}
                  onClick={() => setTab(tabDef.id)}
                >
                  {t(tabDef.labelKey, tabDef.fallback)}
                </button>
              ))}
            </nav>

            <LanguagePicker appearance={appearance} />
          </div>
        </div>
      </header>

      {/* ── main ─────────────────────────────────────────────────────── */}
      <main className="hra-app-main flex-1">

        {online === false && (
          <div className="mb-5">
            <ErrorBanner message={t("app.serverUnreachable", "API server unreachable — run: cd garmin-stats && node src/server.ts")} />
          </div>
        )}

        {/* Date-range controls — left-aligned, above the tab content (moved
            out of the header). Overview & Trends renders its own DateRangeBar
            internally now (wrapped, with the Summary card, in one sticky
            header — see OverviewTab.tsx), so it's excluded here to avoid a
            duplicate bar. */}
        {showDateRange && tab !== "overview" && (
          <div className="mb-5">
            <DateRangeBar {...range} savedRanges={savedRanges} racePicker={tab === "activities" ? racePicker : undefined} />
          </div>
        )}

        {tab === "overview"   && (
          <OverviewTab range={range} compareRange={compareRange} savedRanges={savedRanges} />
        )}
        {tab === "activities" && <ActivitiesTab from={range.from} to={range.to} />}
        {tab === "plans"      && <PlansTab />}
        {tab === "body"       && <BodyTab       from={range.from} to={range.to} />}
        {tab === "manage"     && <ManageTab savedRanges={savedRanges} />}
        {tab === "settings"   && <SettingsTab appearance={appearance} />}
        {tab === "feedback"   && <FeedbackTab />}
      </main>

      {/* Global success/error notifications (utils/toast.ts) — mounted once
          here so any component can call notify() without a Provider. */}
      <ToastContainer />
      </div>
    </>
  );
}
