import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import "@/i18n";
import {
  CalendarDays, ListTodo, TrendingUp, Activity as ActivityIcon,
  HeartPulse, RefreshCw, Settings as SettingsIcon, MessageSquare,
  PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
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
import { AgendaTab }    from "@/components/AgendaTab";
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

// labelKey/fallback: the sidebar nav's own strings are the one concrete
// pipeline example proving i18n end to end (HRA-104) — fallback is the
// pre-existing English literal, used as t()'s defaultValue so nothing flashes
// a bare translation key before the backend bundle loads.
// `group` drives sidebar section placement (HRA-253) — top→bottom: primary
// (no heading), review (under "Review"), manage (under "Manage"), utility
// (Settings/Feedback, pinned to the bottom of the nav). `icon` is purely
// decorative (aria-hidden at render) — the visible label remains each item's
// one accessible name.
const TABS = [
  { id: "agenda",      labelKey: "nav.agenda",        fallback: "Your agenda",       group: "primary", icon: CalendarDays   },
  { id: "plans",       labelKey: "nav.trainingPlans",  fallback: "Training plans",   group: "primary", icon: ListTodo       },
  { id: "overview",    labelKey: "nav.overview",       fallback: "Overview & Trends", group: "review",  icon: TrendingUp     },
  { id: "activities",  labelKey: "nav.activities",     fallback: "Activities",       group: "review",  icon: ActivityIcon   },
  { id: "body",        labelKey: "nav.body",           fallback: "Body",             group: "review",  icon: HeartPulse     },
  { id: "manage",      labelKey: "nav.manage",         fallback: "Data & Sync",      group: "manage",  icon: RefreshCw      },
  { id: "settings",    labelKey: "nav.settings",       fallback: "Settings",         group: "utility", icon: SettingsIcon   },
  { id: "feedback",    labelKey: "nav.feedback",       fallback: "Feedback",         group: "utility", icon: MessageSquare  },
] as const;

type TabId = typeof TABS[number]["id"];
type TabDef = typeof TABS[number];

// Manage tab doesn't need the global date bar to be the primary control
const TABS_WITH_DATERANGE: TabId[] = ["overview", "activities", "body"];

// Stable (module-scope) URL-key objects for the two global ranges (HRA-196)
// — a fresh object literal passed inline on every render would defeat the
// hooks' internal referential-equality dependency arrays.
const RANGE_URL_KEYS = { from: "from", to: "to" };
const COMPARE_URL_KEYS = { from: "compareFrom", to: "compareTo", enabled: "compareEnabled" };

// A pure client-side layout preference (direct feedback) — no reason to sync
// across devices or live in the backend settings table, unlike every other
// appearance choice in this app (frontend rules: "this app deliberately
// avoids localStorage" — the documented exception is an ephemeral,
// tab-scoped flag with no reason to persist further, which this ALMOST is,
// except a user who collapses the sidebar once plausibly wants that to
// stick across future visits too, not just this tab — localStorage (not
// sessionStorage, unlike SplashScreen's genuinely one-time flag) is the
// reasonable choice for that specific need).
const SIDEBAR_COLLAPSED_KEY = "hra-sidebar-collapsed";

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
  // lands on the same tab instead of bouncing back to the default. An
  // unknown or missing value falls back to "Your agenda" here (not inside
  // useUrlState, which stays a generic string primitive with no knowledge
  // of TabId) — HRA-248: the app's default landing tab, ahead of Overview.
  const [rawTab, setTab] = useUrlState("tab", "agenda");
  const tab: TabId = TABS.some(tabDef => tabDef.id === rawTab) ? (rawTab as TabId) : "agenda";
  const [online, setOnline] = useState<boolean | null>(null);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false; // storage unavailable (e.g. private mode) — starts expanded
    }
  });
  function setSidebarCollapsed(next: boolean) {
    setSidebarCollapsedState(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // storage unavailable — the toggle still works for this render, just
      // won't be remembered next time.
    }
  }

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

  const primaryTabs = TABS.filter(tabDef => tabDef.group === "primary");
  const reviewTabs = TABS.filter(tabDef => tabDef.group === "review");
  const manageTabs = TABS.filter(tabDef => tabDef.group === "manage");
  const utilityTabs = TABS.filter(tabDef => tabDef.group === "utility");

  // Shared renderer for every sidebar destination (HRA-253) — same
  // id/labelKey/fallback shape and tab/setTab mechanism the old header nav
  // used, just grouped now. `aria-current="page"` (not a custom class) is the
  // one active-item signal so assistive tech and CSS share the same source of
  // truth; the icon is aria-hidden, so the item's one accessible name is its
  // visible label text.
  function renderNavItem(tabDef: TabDef) {
    const Icon = tabDef.icon;
    const isActive = tab === tabDef.id;
    const label = t(tabDef.labelKey, tabDef.fallback);
    return (
      <button
        key={tabDef.id}
        type="button"
        className={[
          "hra-sidebar-item", "hra-nav-hover",
          tabDef.id === "manage" ? "hra-sidebar-manage" : "",
        ].filter(Boolean).join(" ")}
        aria-current={isActive ? "page" : undefined}
        data-active={tabDef.id === "manage" ? isActive : undefined}
        onClick={() => setTab(tabDef.id)}
        title={sidebarCollapsed ? label : undefined}
      >
        <span className="hra-sidebar-item-icon" aria-hidden="true"><Icon size={16} /></span>
        {/* Visually hidden (not display:none) while collapsed — .hra-sidebar-item-label,
            index.css — so the label stays the item's one accessible name for
            assistive tech even when icon-only; `title` above covers sighted
            mouse users the same way. */}
        <span className="hra-sidebar-item-label">{label}</span>
      </button>
    );
  }

  return (
    <>
      {/* HRA-223: mounted once at the top of AppShell, gating the rest of
          the UI until dismissed (skip or autoplay finish) — self-contained,
          reads/writes its own sessionStorage flag. */}
      <SplashScreen />
      <div className="flex h-screen overflow-hidden">
      {/* Ambient glow is a pure body::before (index.css) now — no JS-rendered
          layer here (correction pass). */}

      {/* ── sidebar (HRA-253) ───────────────────────────────────────────── */}
      {/* Persistent left shell, replacing the old horizontal header/nav —
          stays visible while the content column (below) scrolls
          independently. Collapsible to an icon-only rail (direct feedback) —
          data-collapsed drives every width/label-visibility rule in
          index.css; sidebarCollapsed/setSidebarCollapsed above persists the
          choice to localStorage. Top row: brand + language picker, side by
          side (language picker goes icon-only too via its own `compact`
          prop). One <nav> landmark holds every tab destination (Primary,
          then Review/Manage under their own headings, then the
          Settings/Feedback utility pair pinned to the nav's own bottom via
          .hra-sidebar-utility-group's margin-top: auto). The collapse toggle
          sits below <nav>, always icon-only in both states. The
          server-status dot was removed post-review (kept only the `online`
          state driving the ErrorBanner in <main>, unrelated to the
          sidebar). */}
      <aside className="hra-sidebar" data-collapsed={sidebarCollapsed}>
        <div className="hra-sidebar-top">
          <span className="hra-brand">Runs Free</span>
          <LanguagePicker appearance={appearance} compact={sidebarCollapsed} />
        </div>

        <nav className="hra-sidebar-nav" aria-label={t("nav.mainNavigation", "Main navigation")}>
          <div className="hra-sidebar-core">
            <div className="hra-sidebar-group">
              {primaryTabs.map(renderNavItem)}
            </div>
            <div className="hra-sidebar-group">
              <span className="hra-sidebar-group-heading">{t("nav.groupReview", "Review")}</span>
              {reviewTabs.map(renderNavItem)}
            </div>
            <div className="hra-sidebar-group">
              <span className="hra-sidebar-group-heading">{t("nav.groupManage", "Manage")}</span>
              {manageTabs.map(renderNavItem)}
            </div>
          </div>

          <div className="hra-sidebar-group hra-sidebar-utility-group">
            {utilityTabs.map(renderNavItem)}
          </div>
        </nav>

        <button
          type="button"
          className="hra-sidebar-collapse-toggle hra-nav-hover"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? t("nav.expandSidebar", "Expand sidebar") : t("nav.collapseSidebar", "Collapse sidebar")}
          title={sidebarCollapsed ? t("nav.expandSidebar", "Expand sidebar") : t("nav.collapseSidebar", "Collapse sidebar")}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
        </button>
      </aside>

      {/* ── content column ──────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 h-screen overflow-y-auto">
        <main className="hra-app-main flex-1">

          {online === false && (
            <div className="mb-5">
              <ErrorBanner message={t("app.serverUnreachable", "API server unreachable — run: cd garmin-stats && node src/server.ts")} />
            </div>
          )}

          {/* Date-range controls — left-aligned, above the tab content.
              Overview & Trends renders its own DateRangeBar internally now
              (wrapped, with the Summary card, in one sticky header — see
              OverviewTab.tsx), so it's excluded here to avoid a duplicate
              bar. */}
          {showDateRange && tab !== "overview" && (
            <div className="mb-5">
              <DateRangeBar {...range} savedRanges={savedRanges} racePicker={tab === "activities" ? racePicker : undefined} />
            </div>
          )}

          {tab === "agenda"     && <AgendaTab onNavigateToPlans={() => setTab("plans")} />}
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

        {/* Global success/error notifications (utils/toast.ts) — mounted
            once here so any component can call notify() without a Provider.
            Fixed-position (.hra-toast-stack), so its DOM position within the
            content column is not visually load-bearing. */}
        <ToastContainer />
      </div>
      </div>
    </>
  );
}
