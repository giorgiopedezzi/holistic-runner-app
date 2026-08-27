import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { useDateRange } from "@/hooks/useDateRange";
import { useCompareRange } from "@/hooks/useCompareRange";
import { useAppearance } from "@/hooks/useAppearance";
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
import { LanguagePicker } from "@/components/LanguagePicker";
import { ErrorBanner }  from "@/components/ui";

// labelKey/fallback: the header nav bar's own strings are the one concrete
// pipeline example proving i18n end to end (HRA-104) — fallback is the
// pre-existing English literal, used as t()'s defaultValue so nothing flashes
// a bare translation key before the backend bundle loads.
const TABS = [
  { id: "overview",    labelKey: "nav.overview",   fallback: "Overview & Trends" },
  { id: "activities",  labelKey: "nav.activities", fallback: "Activities"        },
  { id: "plans",       labelKey: "nav.trainingPlans", fallback: "Training plans" },
  { id: "body",        labelKey: "nav.body",       fallback: "Body"              },
  { id: "manage",      labelKey: "nav.manage",     fallback: "Data & Sync"       },
  { id: "settings",    labelKey: "nav.settings",   fallback: "Settings"          },
] as const;

type TabId = typeof TABS[number]["id"];

// Manage tab doesn't need the global date bar to be the primary control
const TABS_WITH_DATERANGE: TabId[] = ["overview", "activities", "body"];

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
  const range = useDateRange(30);
  // Only meaningful on the Overview & Trends tab (the only consumer of a
  // "compare to" range), but created here rather than inside OverviewTab so
  // DateRangeBar — rendered once, above the tab content, shared across tabs
  // — can host its pickers. Passed to DateRangeBar/OverviewTab only while
  // tab === "overview" below; the hook itself is cheap to keep alive
  // regardless of which tab is active.
  const compareRange = useCompareRange(range.from, range.to);
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
  const [tab, setTab] = useState<TabId>("overview");
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
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
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
                title={online ? t("app.serverConnected", "Server connected") : t("app.serverOffline", "Server offline")}
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
                  style={{
                    padding: tab === tabDef.id ? "6px 16px" : "5px 12px",
                    fontSize: 13,
                    fontWeight: tab === tabDef.id ? 600 : 400,
                  }}
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
      <main style={{ flex: 1, maxWidth: 1240, width: "100%", margin: "0 auto", padding: "24px 24px 48px" }}>

        {online === false && (
          <div style={{ marginBottom: 20 }}>
            <ErrorBanner message={t("app.serverUnreachable", "API server unreachable — run: cd garmin-stats && node src/server.ts")} />
          </div>
        )}

        {/* Date-range controls — left-aligned, above the tab content (moved
            out of the header). Overview & Trends renders its own DateRangeBar
            internally now (wrapped, with the Summary card, in one sticky
            header — see OverviewTab.tsx), so it's excluded here to avoid a
            duplicate bar. */}
        {showDateRange && tab !== "overview" && (
          <div style={{ marginBottom: 20 }}>
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
      </main>

      {/* Global success/error notifications (utils/toast.ts) — mounted once
          here so any component can call notify() without a Provider. */}
      <ToastContainer />
    </div>
  );
}
