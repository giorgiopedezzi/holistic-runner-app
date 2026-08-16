import { useState, useEffect } from "react";
import { useDateRange } from "@/hooks/useDateRange";
import { useAppearance } from "@/hooks/useAppearance";
import { SettingsProvider } from "@/hooks/useSettings";
import { DateRangeBar } from "@/components/DateRangeBar";
import { OverviewTab }  from "@/components/OverviewTab";
import { ActivitiesTab } from "@/components/ActivitiesTab";
import { BodyTab }      from "@/components/BodyTab";
import { ManageTab }    from "@/components/ManageTab";
import { SettingsTab }  from "@/components/SettingsTab";
import { ErrorBanner }  from "@/components/ui";

const TABS = [
  { id: "overview",    label: "Overview & Trends" },
  { id: "activities",  label: "Activities"        },
  { id: "body",        label: "Body"              },
  { id: "manage",      label: "Data & Sync"       },
  { id: "settings",    label: "Settings"          },
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
  const appearance = useAppearance();
  const [tab, setTab] = useState<TabId>("overview");
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/v1/range")
      .then(() => setOnline(true))
      .catch(() => setOnline(false));
  }, []);

  const showDateRange = TABS_WITH_DATERANGE.includes(tab as typeof TABS_WITH_DATERANGE[number]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Ambient glow is a pure body::before (index.css) now — no JS-rendered
          layer here (correction pass). */}

      {/* ── header ───────────────────────────────────────────────────── */}
      {/* Two compact rows (correction pass — undoes an earlier single-row
          merge): row 1 is brand + nav; row 2, only for date-range tabs, is
          the range controls, right-aligned. DateRangeBar's own controls are
          smaller here (see DateRangeBar.tsx) — both rows are shorter than
          the old single merged row, so the hero starts higher.
          `.hra-header-inner` shares <main>'s own maxWidth/padding (860px,
          24px) so the nav tabs and date-range filters land in the exact
          same left/right columns as the graphs/cards below them — the
          header bar itself stays full-bleed (background/blur/border), only
          its content is column-aligned. */}
      <header className="hra-header">
        <div className="hra-header-inner">
          <div className="hra-header-row">
            <span className="hra-brand">Garmin Stats</span>

            {online !== null && (
              <span
                className="hra-status-dot"
                data-online={online}
                title={online ? "Server connected" : "Server offline"}
              />
            )}

            <nav className="hra-nav">
              {TABS.map(t => (
                <button
                  key={t.id}
                  className={[
                    "hra-pill", "hra-nav-pill", "hra-nav-hover",
                    t.id === "manage" ? "hra-nav-manage" : "",
                    tab === t.id ? "hra-pill-active" : "",
                  ].filter(Boolean).join(" ")}
                  data-active={t.id === "manage" ? tab === t.id : undefined}
                  onClick={() => setTab(t.id)}
                  style={{
                    padding: tab === t.id ? "6px 16px" : "5px 12px",
                    fontSize: 13,
                    fontWeight: tab === t.id ? 600 : 400,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>

          {showDateRange && (
            <div className="hra-header-row hra-header-row--controls">
              <DateRangeBar {...range} />
            </div>
          )}
        </div>
      </header>

      {/* ── main ─────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: 860, width: "100%", margin: "0 auto", padding: "24px 24px 48px" }}>

        {online === false && (
          <div style={{ marginBottom: 20 }}>
            <ErrorBanner message="API server unreachable — run: cd garmin-stats && node src/server.ts" />
          </div>
        )}

        {tab === "overview"   && <OverviewTab   from={range.from} to={range.to} />}
        {tab === "activities" && <ActivitiesTab from={range.from} to={range.to} />}
        {tab === "body"       && <BodyTab       from={range.from} to={range.to} />}
        {tab === "manage"     && <ManageTab />}
        {tab === "settings"   && <SettingsTab appearance={appearance} />}
      </main>
    </div>
  );
}
