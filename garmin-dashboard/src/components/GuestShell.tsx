import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Compass, LogIn, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { api } from "@/api/client";
import { GuestOverview } from "@/components/GuestOverview";
import { type GuestRoute, type GuestView, guestPath, parseGuestRoute } from "@/routing/guestRoute";

type ViewportTier = "desktop" | "tablet" | "phone";
type SidebarMode = "open" | "icon" | "hidden";

function viewportTier(width: number): ViewportTier {
  if (width >= 1024) return "desktop";
  if (width >= 768) return "tablet";
  return "phone";
}

function defaultSidebarMode(tier: ViewportTier): SidebarMode {
  return tier === "desktop" ? "open" : tier === "tablet" ? "icon" : "hidden";
}

// HRA-362 intentionally stops at the public shell. HRA-363 owns the founder
// journey content and its public-projection reads, so this component makes no
// owner-data request while an anonymous visitor is present.
export function GuestShell() {
  const { t } = useTranslation();
  const [route, setRoute] = useState<GuestRoute>(() => parseGuestRoute(window.location.pathname));
  const [tier, setTier] = useState<ViewportTier>(() => viewportTier(window.innerWidth));
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() => defaultSidebarMode(viewportTier(window.innerWidth)));

  useEffect(() => {
    function onResize() {
      const nextTier = viewportTier(window.innerWidth);
      setTier(previous => {
        if (previous !== nextTier) setSidebarMode(defaultSidebarMode(nextTier));
        return nextTier;
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Direct load/refresh of a public URL is parsed on mount above; a browser
  // back/forward navigation only changes window.location (pushState below
  // fires no event of its own), so this Story's "refresh-safe" URLs also
  // need an explicit popstate listener to stay in sync (HRA-368).
  useEffect(() => {
    function onPopState() {
      setRoute(parseGuestRoute(window.location.pathname));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function toggleSidebar() {
    if (tier === "phone") {
      setSidebarMode(mode => mode === "hidden" ? "open" : "hidden");
      return;
    }
    setSidebarMode(mode => mode === "icon" ? "open" : "icon");
  }

  function closeSidebar() {
    if (tier === "phone") setSidebarMode("hidden");
  }

  const collapsed = sidebarMode === "icon" ? "true" : sidebarMode === "hidden" ? "hidden" : "false";
  const signIn = () => api.auth.login();

  function navigate(nextView: GuestView, id?: string | null) {
    const path = guestPath(route.slug, nextView, id);
    if (path !== window.location.pathname) window.history.pushState({}, "", path);
    setRoute({
      slug: route.slug,
      view: nextView,
      activityId: nextView === "activities" ? id ?? null : null,
      reportId: nextView === "reports" ? id ?? null : null,
    });
    closeSidebar();
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {tier === "phone" && sidebarMode === "open" && <div className="hra-sidebar-backdrop" onClick={closeSidebar} />}
      <aside className="hra-sidebar" data-collapsed={collapsed} data-tier={tier}>
        <div className="hra-sidebar-top"><span className="hra-brand">{sidebarMode === "icon" ? <>DR<span className="hra-brand-accent">F</span></> : <>Dreams run <span className="hra-brand-accent">free</span></>}</span></div>
        <nav className="hra-sidebar-nav" aria-label={t("nav.mainNavigation", "Main navigation")}>
          <div className="hra-sidebar-core"><div className="hra-sidebar-group">
            <span className="hra-sidebar-group-heading">{t("guest.navigation", "Guest")}</span>
            <button type="button" className="hra-sidebar-item hra-nav-hover" aria-current={route.view === "journey" ? "page" : undefined} onClick={() => navigate("journey")}><span className="hra-sidebar-item-icon" aria-hidden="true"><Compass size={16} /></span><span className="hra-sidebar-item-label">{t("guest.founderJourney", "Founder journey")}</span></button>
            <button type="button" className="hra-sidebar-item hra-nav-hover" aria-current={route.view === "plan" ? "page" : undefined} onClick={() => navigate("plan")}><span className="hra-sidebar-item-icon" aria-hidden="true"><Compass size={16} /></span><span className="hra-sidebar-item-label">{t("guest.currentPlan", "Current plan")}</span></button>
            <button type="button" className="hra-sidebar-item hra-nav-hover" aria-current={route.view === "activities" ? "page" : undefined} onClick={() => navigate("activities")}><span className="hra-sidebar-item-icon" aria-hidden="true"><Compass size={16} /></span><span className="hra-sidebar-item-label">{t("guest.activities.navigation", "Activities")}</span></button>
            <button type="button" className="hra-sidebar-item hra-nav-hover" aria-current={route.view === "reports" ? "page" : undefined} onClick={() => navigate("reports")}><span className="hra-sidebar-item-icon" aria-hidden="true"><Compass size={16} /></span><span className="hra-sidebar-item-label">{t("guest.reports.navigation", "Progress")}</span></button>
          </div></div>
          <div className="hra-sidebar-group hra-sidebar-utility-group">
            <button type="button" className="hra-sidebar-item hra-nav-hover" onClick={signIn}><span className="hra-sidebar-item-icon" aria-hidden="true"><LogIn size={16} /></span><span className="hra-sidebar-item-label">{t("guest.signIn", "Sign in")}</span></button>
          </div>
        </nav>
        {tier !== "phone" && <button type="button" className="hra-sidebar-collapse-toggle hra-nav-hover" onClick={toggleSidebar} aria-label={sidebarMode === "icon" ? t("nav.expandSidebar", "Expand sidebar") : t("nav.collapseSidebar", "Collapse sidebar")} title={sidebarMode === "icon" ? t("nav.expandSidebar", "Expand sidebar") : t("nav.collapseSidebar", "Collapse sidebar")}>{sidebarMode === "icon" ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}</button>}
      </aside>
      <div className="flex flex-col flex-1 min-w-0 h-screen overflow-y-auto">
        {tier === "phone" && sidebarMode === "hidden" && <header className="hra-mobile-header"><button type="button" className="hra-mobile-header-trigger hra-nav-hover" onClick={toggleSidebar} aria-label={t("nav.openSidebar", "Open navigation")}><Menu size={18} aria-hidden="true" /></button></header>}
        <main className="hra-app-main">
          <GuestOverview
            slug={route.slug}
            view={route.view}
            activityId={route.activityId}
            reportId={route.reportId}
            onNavigateToPlan={() => navigate("plan")}
            onNavigateToJourney={() => navigate("journey")}
            onNavigateToActivity={id => navigate("activities", id)}
            onNavigateToReport={id => navigate("reports", id)}
            onSignIn={signIn}
          />
        </main>
      </div>
    </div>
  );
}
