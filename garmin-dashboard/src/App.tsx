import { useState, useEffect, useSyncExternalStore } from "react";
import { useDateRange } from "@/hooks/useDateRange";
import { useAppearance } from "@/hooks/useAppearance";
import { SettingsProvider } from "@/hooks/useSettings";
import { DateRangeBar } from "@/components/DateRangeBar";
import { OverviewTab }  from "@/components/OverviewTab";
import { ActivitiesTab } from "@/components/ActivitiesTab";
import { BodyTab }      from "@/components/BodyTab";
import { ManageTab }    from "@/components/ManageTab";
import { SettingsTab }  from "@/components/SettingsTab";
import { ErrorBanner, glowPillStyle } from "@/components/ui";

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

// Header/menu shrink (polish pass) — at >=1280px the date-range bar moves
// into the header row itself (right side, next to the nav); narrower than
// that it stays below the header as before. useSyncExternalStore subscribes
// directly to the MediaQueryList's own change event, so the layout flips
// live on a resize/DevTools breakpoint toggle without an effect-driven
// render lag.
const WIDE_HEADER_QUERY = "(min-width: 1280px)";
function subscribeWideHeader(callback: () => void) {
  const mq = window.matchMedia(WIDE_HEADER_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}
function useWideHeader(): boolean {
  return useSyncExternalStore(subscribeWideHeader, () => window.matchMedia(WIDE_HEADER_QUERY).matches);
}

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
  const wideHeader = useWideHeader();

  useEffect(() => {
    fetch("/api/v1/range")
      .then(() => setOnline(true))
      .catch(() => setOnline(false));
  }, []);

  const showDateRange = TABS_WITH_DATERANGE.includes(tab as typeof TABS_WITH_DATERANGE[number]);
  // >=1280px: the date-range bar lives in the header, next to the nav —
  // narrower than that it renders once, below the header, as before. Never
  // both at once (that would double-mount DateRangeBar's own DatePicker
  // popovers), so this single boolean gates both spots.
  const dateRangeInHeader = wideHeader && showDateRange;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div className="hra-ambient-glow" />

      {/* ── header ───────────────────────────────────────────────────── */}
      {/* Shrunk to ~48px (was 52px), backdrop-blur over a translucent
          surface so the ambient glow shows through the sticky header
          instead of being fully occluded by it. */}
      <header style={{
        borderBottom: "1px solid color-mix(in srgb, var(--accent) 12%, var(--border))", padding: "0 20px",
        display: "flex", alignItems: "center", gap: 20, height: 48,
        background: "color-mix(in srgb, var(--bg-surface) 78%, transparent)",
        backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.01em", flexShrink: 0 }}>
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
            <button key={t.id} className="hra-pill hra-nav-hover" onClick={() => setTab(t.id)} style={{
              background:  "none",
              border:      "1px solid transparent",
              borderRadius:999,
              padding:     tab === t.id ? "6px 16px" : "5px 12px",
              fontSize:    13,
              fontWeight:  tab === t.id ? 600 : 400,
              color:       tab === t.id ? "var(--text-primary)" : "var(--text-secondary)",
              cursor:      "pointer",
              // subtle red tint for manage tab
              ...(t.id === "manage" && tab !== "manage" ? { color: "var(--accent-red)", opacity: 0.7 } : {}),
              ...glowPillStyle(tab === t.id),
            }}>
              {t.label}
            </button>
          ))}
        </nav>

        {dateRangeInHeader && <div style={{ flexShrink: 0 }}><DateRangeBar {...range} /></div>}
      </header>

      {/* ── main ─────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: 860, width: "100%", margin: "0 auto", padding: "24px 24px 48px" }}>

        {online === false && (
          <div style={{ marginBottom: 20 }}>
            <ErrorBanner message="API server unreachable — run: cd garmin-stats && node src/server.ts" />
          </div>
        )}

        {/* date range — shown below the header on narrower widths, moves
            into the header itself at >=1280px (see dateRangeInHeader) */}
        {showDateRange && !dateRangeInHeader && (
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
