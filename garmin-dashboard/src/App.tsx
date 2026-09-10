import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import "@/i18n";
import {
  CalendarDays, ListTodo, TrendingUp, Activity as ActivityIcon,
  HeartPulse, RefreshCw, Settings as SettingsIcon, MessageSquare,
  PanelLeftClose, PanelLeftOpen, Menu, X,
} from "lucide-react";
import { useDateRange } from "@/hooks/useDateRange";
import { useCompareRange } from "@/hooks/useCompareRange";
import { useAppearance } from "@/hooks/useAppearance";
import { useUrlState } from "@/hooks/useUrlState";
import { useQuery } from "@/hooks/useQuery";
import { api } from "@/api/client";
import { SettingsProvider } from "@/hooks/useSettings";
import { UnsavedGuardProvider, useUnsavedGuard } from "@/hooks/useUnsavedGuard";
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

// Same reasoning/precedent as SIDEBAR_COLLAPSED_KEY above — dismissing the
// feedback ribbon is a pure client-side UI preference (HRA-303's own
// fallback instruction: "if none exists, use local storage with a
// versioned key"), not something that needs to sync across devices via the
// backend settings table. Versioned so a future change to the banner's own
// message/purpose can re-surface it to someone who dismissed an older one.
const FEEDBACK_BANNER_DISMISSED_KEY = "hra-feedback-banner-dismissed-v1";

function readBannerDismissed(): boolean {
  try {
    return localStorage.getItem(FEEDBACK_BANNER_DISMISSED_KEY) === "1";
  } catch {
    return false; // storage unavailable — banner just shows every time
  }
}

// HRA-267: 3-state responsive sidebar. `open`/`icon` are the two desktop
// states the collapse toggle already had; `hidden` is the new phone-tier
// state (off-canvas, reopened as an overlay via the hamburger). Breakpoints
// match the Story's spec exactly: >=1024 desktop, 768-1023 tablet, <768
// phone.
type ViewportTier = "desktop" | "tablet" | "phone";
type SidebarMode = "open" | "icon" | "hidden";

function resolveViewportTier(width: number): ViewportTier {
  if (width >= 1024) return "desktop";
  if (width >= 768) return "tablet";
  return "phone";
}

function defaultSidebarMode(tier: ViewportTier): SidebarMode {
  if (tier === "phone") return "hidden";
  if (tier === "tablet") return "icon";
  return "open";
}

function readPersistedDesktopCollapse(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false; // storage unavailable (e.g. private mode) — starts expanded
  }
}

// Sticky feedback ribbon on desktop/tablet, in normal document flow on
// phone (HRA-303: it must scroll out of view there, not stay pinned over
// content — see .hra-feedback-banner's own phone media rule) — pinned above
// the content column's own scroll area at the wider tiers (direct feedback
// — "make sure people actually notice the feedback page"). The clickable
// word lives inside the translated sentence itself, not bolted on
// before/after it, so its position stays natural in every language: the
// default string carries a "((feedback))" marker translators can move
// anywhere, and this splits on that marker to insert a real <button>
// (never a translated whole sentence baked into two separate keys, which
// would fight word order in languages that don't put the link where
// English does).
function FeedbackBanner({ onNavigate, onDismiss }: { onNavigate: () => void; onDismiss: () => void }) {
  const { t } = useTranslation();
  const raw = t("banner.feedbackPrompt", "Your anonymous ((feedback)) is my most valuable asset if you want this app to keep improving.");
  const [before, linkWord, after] = raw.split(/\(\((.+?)\)\)/);
  return (
    <div className="hra-feedback-banner text-label">
      <span className="hra-feedback-banner-text">
        {before}
        <button type="button" className="hra-feedback-banner-link" onClick={onNavigate}>
          {linkWord ?? t("nav.feedback", "Feedback")}
        </button>
        {after}
      </span>
      <button
        type="button"
        className="hra-feedback-banner-dismiss hra-nav-hover"
        onClick={onDismiss}
        aria-label={t("banner.dismiss", "Close feedback message")}
        title={t("banner.dismiss", "Close feedback message")}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

// SettingsProvider wraps AppShell (not the other way in-line) so every hook
// below it — including useAppearance(), called inside AppShell's own body —
// is a descendant of the provider and shares its one settings fetch.
export default function App() {
  return (
    <SettingsProvider>
      <UnsavedGuardProvider>
        <AppShell />
      </UnsavedGuardProvider>
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
  // HRA-281: gates every in-app navigation that could discard the race-plan
  // instance editor's unsaved work (PlanInstancesSection.tsx registers its
  // own dirty check via useUnsavedGuard's setGuard) — a no-op pass-through
  // whenever nothing is dirty.
  const { guardedAction } = useUnsavedGuard();
  // Backed by the URL's `tab` param (HRA-193) so a refresh or a direct link
  // lands on the same tab instead of bouncing back to the default. An
  // unknown or missing value falls back to "Your agenda" here (not inside
  // useUrlState, which stays a generic string primitive with no knowledge
  // of TabId) — HRA-248: the app's default landing tab, ahead of Overview.
  const [rawTab, setTab] = useUrlState("tab", "agenda");
  const tab: TabId = TABS.some(tabDef => tabDef.id === rawTab) ? (rawTab as TabId) : "agenda";
  // HRA-265: writes the same `activityId` URL param ActivitiesTab.tsx's own
  // useUrlState call reads on mount — this instance never reads its own
  // `value` back (ActivitiesTab, freshly mounted on the tab switch below, is
  // the one source of truth for it), only ever writes, same "independent
  // call sites merge into the one live query string" pattern useUrlState's
  // own doc comment describes (HRA-193).
  const [, setActivityIdParam] = useUrlState("activityId", "");
  function navigateToActivity(activityId: number) {
    guardedAction(() => {
      setActivityIdParam(String(activityId));
      setTab("activities");
    });
  }
  const [online, setOnline] = useState<boolean | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(readBannerDismissed);
  function dismissBanner() {
    setBannerDismissed(true);
    try {
      localStorage.setItem(FEEDBACK_BANNER_DISMISSED_KEY, "1");
    } catch {
      // storage unavailable — dismissal still applies for this session
    }
  }
  const [viewportTier, setViewportTier] = useState<ViewportTier>(() =>
    resolveViewportTier(window.innerWidth)
  );
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() => {
    const tier = resolveViewportTier(window.innerWidth);
    return tier === "desktop" ? (readPersistedDesktopCollapse() ? "icon" : "open") : defaultSidebarMode(tier);
  });

  // Tracks the live viewport tier across resize/rotation — a plain `resize`
  // listener (not matchMedia) covers both window resize and device rotation
  // identically and needs no extra query objects.
  useEffect(() => {
    function handleResize() {
      const nextTier = resolveViewportTier(window.innerWidth);
      setViewportTier(prev => (prev === nextTier ? prev : nextTier));
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Crossing a tier boundary always re-resolves the sidebar to that tier's
  // own default (Story scope: "a manual toggle overrides the tier default
  // only until the viewport crosses into a different tier") — desktop's
  // default still reads the persisted manual collapse choice; tablet/phone
  // never persist and always come back to their fixed default. Skipped on
  // the very first render since the initializer above already resolved the
  // correct starting mode.
  const tierMounted = useRef(false);
  useEffect(() => {
    if (!tierMounted.current) { tierMounted.current = true; return; }
    setSidebarMode(viewportTier === "desktop"
      ? (readPersistedDesktopCollapse() ? "icon" : "open")
      : defaultSidebarMode(viewportTier));
  }, [viewportTier]);

  // Desktop/tablet: toggles open<->icon-only, same rail both tiers share;
  // only desktop persists the choice (Story scope). Phone: toggles the
  // hidden<->open overlay drawer instead — there is no icon-only rail there.
  function toggleSidebar() {
    if (viewportTier === "phone") {
      setSidebarMode(prev => (prev === "hidden" ? "open" : "hidden"));
      return;
    }
    const next: SidebarMode = sidebarMode === "icon" ? "open" : "icon";
    setSidebarMode(next);
    if (viewportTier === "desktop") {
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next === "icon" ? "1" : "0");
      } catch {
        // storage unavailable — the toggle still works for this render, just
        // won't be remembered next time.
      }
    }
  }

  // Dismisses the phone overlay drawer — outside-tap (backdrop click) or
  // picking a nav item (AC3) both route through this.
  function closeSidebarOverlay() {
    if (viewportTier === "phone") setSidebarMode("hidden");
  }

  // HRA-303 AC4: focus must return to the hamburger trigger once the phone
  // drawer closes. The trigger button only exists in the DOM while
  // sidebarMode === "hidden" (it unmounts while the drawer is open, same as
  // before this Story), so a plain onClick handler on the backdrop/nav-item
  // can't call .focus() on it directly — this effect watches for the
  // hidden transition instead and focuses the just-remounted button once
  // React has committed it. Guarded by drawerWasOpenRef so mounting
  // straight into "hidden" (first load, or crossing tiers into phone) never
  // steals focus that was never inside the drawer to begin with.
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const drawerWasOpenRef = useRef(false);
  useEffect(() => {
    if (viewportTier !== "phone") return;
    if (sidebarMode === "open") { drawerWasOpenRef.current = true; return; }
    if (sidebarMode === "hidden" && drawerWasOpenRef.current) {
      drawerWasOpenRef.current = false;
      hamburgerRef.current?.focus();
    }
  }, [sidebarMode, viewportTier]);

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
        onClick={() => guardedAction(() => { setTab(tabDef.id); closeSidebarOverlay(); })}
        title={sidebarMode === "icon" ? label : undefined}
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

      {/* ── sidebar (HRA-253, 3-state responsive shell HRA-267) ─────────── */}
      {/* Persistent left shell, replacing the old horizontal header/nav —
          stays visible while the content column (below) scrolls
          independently. Three states now drive `data-collapsed`: "false"
          (open, icons+labels), "true" (icon-only rail — desktop's own
          manual collapse, or tablet's own default), "hidden" (phone's
          default, fully off-canvas). `data-tier` mirrors the live viewport
          tier so index.css can turn "hidden"/"open" at the phone tier into
          an off-canvas/overlay-drawer pair instead of the desktop/tablet
          in-flow rail. Only desktop's manual choice persists to
          localStorage (SIDEBAR_COLLAPSED_KEY); tablet/phone always resolve
          from their tier default each session (Story scope). Top row: brand
          + language picker, side by side (language picker goes icon-only
          too via its own `compact` prop). One <nav> landmark holds every
          tab destination (Primary, then Review/Manage under their own
          headings, then the Settings/Feedback utility pair pinned to the
          nav's own bottom via .hra-sidebar-utility-group's margin-top:
          auto). The collapse toggle sits below <nav> on desktop/tablet only
          — phone has no icon-only rail, so it's replaced there by the fixed
          hamburger button (opens) and the backdrop/nav-pick (closes). The
          server-status dot was removed post-review (kept only the `online`
          state driving the ErrorBanner in <main>, unrelated to the
          sidebar). */}
      {viewportTier === "phone" && sidebarMode === "open" && (
        <div className="hra-sidebar-backdrop" onClick={closeSidebarOverlay} />
      )}
      <aside
        className="hra-sidebar"
        data-collapsed={sidebarMode === "icon" ? "true" : sidebarMode === "hidden" ? "hidden" : "false"}
        data-tier={viewportTier}
      >
        <div className="hra-sidebar-top">
          {/* "Dreams run free" is the brand name, not translatable copy — same
              hardcoded-literal treatment as the splash screen's own lockup
              (SplashScreen.tsx), including "free"/"F" picking up the same
              heart-rate red via .hra-brand-accent. Collapsed rail swaps to
              the "DRF" monogram (still just this one span) rather than
              hiding the brand outright. */}
          <span className="hra-brand">
            {sidebarMode === "icon"
              ? <>DR<span className="hra-brand-accent">F</span></>
              : <>Dreams run <span className="hra-brand-accent">free</span></>}
          </span>
          <LanguagePicker appearance={appearance} compact={sidebarMode === "icon"} guardChange={guardedAction} />
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

        {viewportTier !== "phone" && (
          <button
            type="button"
            className="hra-sidebar-collapse-toggle hra-nav-hover"
            onClick={toggleSidebar}
            aria-label={sidebarMode === "icon" ? t("nav.expandSidebar", "Expand sidebar") : t("nav.collapseSidebar", "Collapse sidebar")}
            title={sidebarMode === "icon" ? t("nav.expandSidebar", "Expand sidebar") : t("nav.collapseSidebar", "Collapse sidebar")}
          >
            {sidebarMode === "icon" ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
          </button>
        )}
      </aside>

      {/* ── content column ──────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 h-screen overflow-y-auto">
        {/* HRA-303: the phone-tier nav trigger now lives in its own in-flow
            application header, sticky at the very top of this scroll
            container — replacing the old `position: fixed` floating button,
            which sat on top of (overlapped) the feedback banner below it.
            The banner (next sibling) renders directly underneath, in normal
            flow, so the two can never overlap by construction. Only shown
            while the drawer itself is hidden, same condition the old fixed
            button used. */}
        {viewportTier === "phone" && sidebarMode === "hidden" && (
          <header className="hra-mobile-header">
            <button
              ref={hamburgerRef}
              type="button"
              className="hra-mobile-header-trigger hra-nav-hover"
              onClick={toggleSidebar}
              aria-label={t("nav.openSidebar", "Open navigation")}
              title={t("nav.openSidebar", "Open navigation")}
            >
              <Menu size={18} aria-hidden="true" />
            </button>
          </header>
        )}
        {tab !== "feedback" && !bannerDismissed && (
          <FeedbackBanner onNavigate={() => guardedAction(() => setTab("feedback"))} onDismiss={dismissBanner} />
        )}
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

          {tab === "agenda"     && (
            <AgendaTab onNavigateToPlans={() => guardedAction(() => setTab("plans"))} onNavigateToActivity={navigateToActivity} />
          )}
          {tab === "overview"   && (
            <OverviewTab range={range} compareRange={compareRange} savedRanges={savedRanges} />
          )}
          {tab === "activities" && <ActivitiesTab from={range.from} to={range.to} />}
          {tab === "plans"      && (
            <PlansTab onNavigateToActivity={navigateToActivity} onNavigateToAgenda={() => guardedAction(() => setTab("agenda"))} />
          )}
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
