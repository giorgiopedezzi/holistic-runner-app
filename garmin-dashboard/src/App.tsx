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

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* ── header ───────────────────────────────────────────────────── */}
      <header style={{
        borderBottom: "1px solid var(--border)", padding: "0 24px",
        display: "flex", alignItems: "center", gap: 24, height: 52,
        background: "var(--bg-surface)", position: "sticky", top: 0, zIndex: 10,
      }}>
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>
          Garmin Stats
        </span>

        {online !== null && (
          <span style={{
            width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
            background: online ? "var(--accent-green)" : "var(--accent-red)",
            display: "inline-block",
          }} title={online ? "Server connected" : "Server offline"} />
        )}

        <nav style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background:  tab === t.id ? "var(--bg-card)" : "none",
              border:      "1px solid",
              borderColor: tab === t.id ? "var(--border-strong)" : "transparent",
              borderRadius:"var(--radius-sm)",
              padding:     "5px 14px",
              fontSize:    13,
              fontWeight:  tab === t.id ? 600 : 400,
              color:       tab === t.id ? "var(--text-primary)" : "var(--text-secondary)",
              transition:  "all 0.15s",
              cursor:      "pointer",
              // subtle red tint for manage tab
              ...(t.id === "manage" && tab !== "manage" ? { color: "var(--accent-red)", opacity: 0.7 } : {}),
            }}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {/* ── main ─────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: 860, width: "100%", margin: "0 auto", padding: "24px 24px 48px" }}>

        {online === false && (
          <div style={{ marginBottom: 20 }}>
            <ErrorBanner message="API server unreachable — run: cd garmin-stats && node src/server.ts" />
          </div>
        )}

        {/* date range — shown for all tabs except manage */}
        {TABS_WITH_DATERANGE.includes(tab as typeof TABS_WITH_DATERANGE[number]) && (
          <div style={{ marginBottom: 24 }}>
            <DateRangeBar {...range} />
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
