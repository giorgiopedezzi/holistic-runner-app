/**
 * SettingsTab.tsx
 * Global app settings, persisted server-side (this app deliberately avoids
 * localStorage — see CLAUDE.md): outlier-detection thresholds used by
 * ActivityModal.tsx's chart, and appearance (theme + automatic ambient
 * glow — the earlier per-user background picture picker was removed in the
 * 2026-08-16 correction pass, see frontend.md's Appearance section).
 */

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { AccordionCard, ErrorBanner, LoadingSpinner } from "@/components/ui";
import type { Settings, Theme, StoredUnitSystem, AccentColor, StylePack } from "@/types/api";
import { THEME_NAMES, ACCENT_COLOR_NAMES, DATE_FORMAT_OPTIONS, STYLE_PACK_NAMES } from "@/types/api";
import { ACCENT_PALETTE } from "@/utils/accent";
import type { AppearanceApi } from "@/hooks/useAppearance";
import { useSettings } from "@/hooks/useSettings";
// The non-converting m:ss formatter (HRA-68 dedup). Used here — not fmt.ts's
// self-converting fmtPace — because outlier_min_speed_kmh is a technical tuning
// parameter always stored/labeled in km/h regardless of the app's unit system,
// so its live pace preview must stay metric-only.
import { fmtMinSecRaw } from "@/utils/fmt";

// Theme swatch labels only — the actual colors are CSS (index.css's
// [data-theme-preview="…"] blocks), not duplicated here as hex literals
// (correction pass, CLAUDE.md's "styles live in index.css"). A swatch still
// needs to show a theme's colors while a DIFFERENT theme is active, which
// data-theme-preview (rather than the real data-theme, which only ever
// reflects the theme actually in effect) makes possible.
const THEME_LABEL: Record<Theme, string> = {
  "dark":  "Dark",
  "light": "Light",
};

// A single theme swatch: the "real system" preview is a small gradient pill
// (light→dark accent, same visual language as the app's own active-nav
// pill/hero ring), over a hairline border in that theme's own accent.
// Selected gets a corner check badge instead of relying on border color
// alone to read as "selected" at a glance. All visuals are
// `.hra-theme-swatch*` classes keyed off `data-theme-preview` (index.css);
// this component only chooses which theme to preview and whether it's
// selected.
function ThemeSwatch({ theme, label, selected, onClick, title }: {
  theme: Theme; label: string; selected: boolean; onClick: () => void; title?: string;
}) {
  return (
    <button
      className="hra-lift hra-theme-swatch"
      data-theme-preview={theme}
      data-selected={selected}
      onClick={onClick}
      title={title}
    >
      <div className="hra-theme-swatch-preview">
        <div className="hra-theme-swatch-pill" />
      </div>
      <div className="hra-theme-swatch-label">{label}</div>
      {selected && <div className="hra-theme-swatch-badge">✓</div>}
    </button>
  );
}

// No "Auto" swatch (removed — was a 3rd persisted value; auto-follow is now
// implicit, not a user choice: a settings row that has never had a theme
// explicitly picked reads as anything other than "dark"/"light" — e.g. the
// legacy 'auto' sentinel a never-touched install still has —
// and resolveTheme() falls back to the OS's prefers-color-scheme live for
// exactly that case, same as before. Clicking either swatch below just
// writes a real, explicit choice for the first time. Until then neither
// swatch is "selected" by name, but whichever one matches the OS's current
// scheme is highlighted anyway, so the picker still shows what's in effect.
export function ThemePicker({ appearance }: { appearance: AppearanceApi }) {
  const { t: translate } = useTranslation();
  const current = appearance.settings?.theme;
  const hasExplicitChoice = current === "dark" || current === "light";

  return (
    <div className="hra-chip-row" style={{ gap: 10 }}>
      {THEME_NAMES.map(t => (
        <ThemeSwatch
          key={t}
          theme={t}
          label={translate(`settings.theme.${t}`, THEME_LABEL[t])}
          selected={hasExplicitChoice ? current === t : appearance.resolvedTheme === t}
          onClick={() => appearance.setTheme(t)}
        />
      ))}
    </div>
  );
}

// Accent picker (HRA-95): a swatch per curated accent, offering all 6.
// Keyboard-navigable for free — these are plain <button>s (Tab, Enter/Space),
// same as ThemePicker above; aria-pressed reflects selection for screen readers.
export function AccentPicker({ appearance }: { appearance: AppearanceApi }) {
  const { t } = useTranslation();
  const current = appearance.settings?.accent_color;
  return (
    // flex-wrap: nowrap — the accent row must stay a single row (all 6
    // curated accents fit comfortably at the settings card's own width);
    // overflow-x lets it scroll rather than wrap on a genuinely narrow
    // viewport instead of silently breaking the "one row" requirement.
    <div style={{ display: "flex", gap: 10, flexWrap: "nowrap", overflowX: "auto", paddingBottom: 2 }}>
      {ACCENT_COLOR_NAMES.map((name: AccentColor) => {
        const def = ACCENT_PALETTE[name];
        const selected = current === name;
        const label = t(`settings.accent.${name}`, def.label);
        return (
          // --swatch-color is the one per-instance hook, feeding both
          // .hra-swatch's hover glow and .hra-accent-swatch's gradient
          // fill/selected border (index.css) — no gradient/border/hex
          // literal computed here (correction pass).
          <button
            key={name}
            className="hra-swatch hra-accent-swatch hra-dyn-color"
            data-selected={selected}
            style={{ "--swatch-color": def.hex, "--dyn-color": def.onAccent } as CSSProperties}
            onClick={() => appearance.setAccentColor?.(name)}
            aria-pressed={selected}
            aria-label={label}
            title={label}
          >
            {selected ? "✓" : ""}
          </button>
        );
      })}
    </div>
  );
}

// Style pack labels only — same "label here, colors in CSS" split ThemePicker
// documents above.
const STYLE_PACK_LABEL: Record<StylePack, string> = {
  boomer: "Boomer",
  genz: "GenZ",
  millennial: "Millennial",
  minimal: "Minimal",
};

// Style pack picker (HRA-119): a full-palette choice orthogonal to Theme and
// Accent above — toggle-pill row, same simple pattern UnitsPicker/
// DateFormatPicker already use (a full swatch-preview mechanism like
// ThemePicker's would need a data-style-pack-preview variant of every pack's
// tokens, out of scope for this Story).
export function StylePackPicker({ appearance }: { appearance: AppearanceApi }) {
  const { t } = useTranslation();
  const current = appearance.settings?.style_pack;
  return (
    <div className="hra-chip-row" style={{ gap: 8 }}>
      {STYLE_PACK_NAMES.map(pack => (
        <button
          key={pack}
          className="hra-toggle-pill"
          data-active={current === pack}
          onClick={() => appearance.setStylePack?.(pack)}
        >
          {t(`settings.stylePack.${pack}`, STYLE_PACK_LABEL[pack])}
        </button>
      ))}
    </div>
  );
}

// Live chrome preview strip (polish pass) — shows the current --accent
// applied to the same real chrome elements used elsewhere in the app (a
// filled button, an active nav-style pill, a link, a focus ring), directly
// under the accent row, so picking a swatch shows its effect immediately
// without having to go find a button on another tab. All visuals are
// `.hra-chrome-preview*` classes (index.css); the active pill reuses
// `.hra-pill-active`, the same class the header/date-range/trend pills do.
function ChromePreviewStrip() {
  const { t } = useTranslation();
  return (
    <div className="hra-chrome-preview">
      <button className="hra-btn" data-variant="accent">{t("settings.appearance.previewButton", "Button")}</button>
      <span className="hra-pill hra-pill-active" style={{ padding: "5px 14px", fontWeight: 600 }}>
        {t("settings.appearance.previewActivePill", "Active pill")}
      </span>
      <a href="#" onClick={e => e.preventDefault()} style={{ fontSize: 12 }}>{t("settings.appearance.previewLink", "Link")}</a>
      <div className="hra-chrome-preview-focus">{t("settings.appearance.previewFocusRing", "Focus ring")}</div>
    </div>
  );
}

const UNIT_SYSTEM_OPTIONS: { value: StoredUnitSystem; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "metric", label: "Metric (km, kg)" },
  { value: "imperial", label: "Imperial (mi, lb)" },
];

export function UnitsPicker({ appearance }: { appearance: AppearanceApi }) {
  const { t } = useTranslation();
  const current = appearance.settings?.unit_system;
  return (
    <div className="hra-row-wrap">
      {UNIT_SYSTEM_OPTIONS.map(opt => {
        const selected = current === opt.value;
        return (
          <button
            key={opt.value}
            className="hra-toggle-pill"
            data-active={selected}
            onClick={() => appearance.setUnits(opt.value)}
          >
            {t(`settings.units.${opt.value}`, opt.label)}
          </button>
        );
      })}
      {current === "auto" && appearance.resolvedUnitSystem && (
        <span className="hra-text-muted" style={{ fontSize: 11 }}>
          {t("settings.units.currentlyNote", `currently: ${appearance.resolvedUnitSystem} (from your browser's locale — there's no direct way to read the OS's actual measurement-system setting)`, { system: appearance.resolvedUnitSystem })}
        </span>
      )}
    </div>
  );
}

// Immediate-apply (like theme/units), one pill per style×region combo — each
// pill's own example date doubles as its label, so there's no separate
// preview needed. appearance.setDateFormat is optional only so the
// pre-existing hand-written AppearanceApi stub keeps compiling unmodified
// (see useAppearance.ts); the real hook always provides it.
export function DateFormatPicker({ appearance }: { appearance: AppearanceApi }) {
  const { t } = useTranslation();
  const current = appearance.settings?.date_format;
  return (
    <div className="hra-chip-row" style={{ gap: 8 }}>
      {DATE_FORMAT_OPTIONS.map(opt => {
        const selected = current === opt.value;
        return (
          <button
            key={opt.value}
            className="hra-toggle-pill"
            data-active={selected}
            onClick={() => appearance.setDateFormat?.(opt.value)}
          >
            {t(`settings.dateFormat.${opt.value}`, opt.label)} <span style={{ opacity: 0.7 }}>· {opt.example}</span>
          </button>
        );
      })}
    </div>
  );
}

function SettingField({ label, current, value, onChange, min, step }: {
  label: string; current: number; value: number; onChange: (v: number) => void;
  min: number; step: number;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="hra-text-secondary" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
        {label}
      </label>
      <div className="hra-row" style={{ gap: 10 }}>
        <input
          type="number" min={min} step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="hra-input-narrow"
        />
        <span className="hra-text-muted" style={{ fontSize: 11 }}>
          {t("settings.currentLabel", "current:")} <strong className="hra-text-secondary">{current}</strong>
        </span>
      </div>
    </div>
  );
}

interface Props {
  appearance: AppearanceApi;
}

export function SettingsTab({ appearance }: Props) {
  const { t } = useTranslation();
  // Reads the shared settings singleton (useSettings, HRA-76) instead of
  // fetching its own copy. `saved` is the last-known-persisted value (what
  // "current: X" shows); `draft` is the editable form state — both still
  // local to this component (not lifted into the shared store) since they
  // track in-progress, per-card edits the rest of the app has no business
  // seeing until Save is clicked. Primed from the shared settings once, the
  // first time it becomes available — not re-synced on every later change,
  // so a click elsewhere (e.g. a theme swatch, which also flows through the
  // shared store) can't clobber an unsaved draft mid-edit.
  const { settings: sharedSettings, loading, error: sharedError, update: updateShared } = useSettings();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const primed = useRef(false);
  // Single-expand accordion, same pattern as ActivitiesTab.tsx's row
  // accordion (one section open at a time; all collapsed by default).
  type SectionKey = "appearance" | "dateFormat" | "units" | "activityDetails" | "overviewTrends" | "outliers";
  const [expanded, setExpanded] = useState<SectionKey | null>(null);
  const toggle = (key: SectionKey) => setExpanded(e => e === key ? null : key);
  // Which card is mid-save / just-saved — one card = one sub-resource, so the two
  // explicit-save cards (Outlier detection, Overview & Trends) each save
  // independently, hitting their own PUT endpoint (HRA-40). Keyed rather than two
  // boolean pairs so only the clicked card shows its own "Saving…/Saved".
  type SaveKey = "outliers" | "trend";
  const [savingKey, setSavingKey] = useState<SaveKey | null>(null);
  const [justSavedKey, setJustSavedKey] = useState<SaveKey | null>(null);

  useEffect(() => {
    if (sharedSettings && !primed.current) {
      primed.current = true;
      setSaved(sharedSettings);
      setDraft(sharedSettings);
    }
  }, [sharedSettings]);

  useEffect(() => {
    if (sharedError) setError(sharedError);
  }, [sharedError]);

  const outliersDirty = !!draft && !!saved && (
    draft.outlier_speed_delta_per_sec !== saved.outlier_speed_delta_per_sec ||
    draft.outlier_cadence_delta_per_sec !== saved.outlier_cadence_delta_per_sec ||
    draft.outlier_min_speed_kmh !== saved.outlier_min_speed_kmh
  );
  const trendDirty = !!draft && !!saved && draft.min_trend_group_size !== saved.min_trend_group_size;

  // Each card persists ONLY its own sub-resource (no combined write). The backend
  // returns the whole settings row, so saved+draft stay fully in sync either way.
  async function saveCard(key: SaveKey, put: (s: Settings) => Promise<Settings>) {
    if (!draft) return;
    setSavingKey(key);
    setJustSavedKey(null);
    setError(null);
    try {
      const updated = await put(draft);
      setSaved(updated);
      setDraft(updated);
      updateShared(updated); // propagate to every other tab sharing the settings singleton
      setJustSavedKey(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.saveFailed", "Failed to save settings"));
    } finally {
      setSavingKey(null);
    }
  }
  const saveOutliers = () => saveCard("outliers", api.settings.updateOutliers);
  const saveThresholds = () => saveCard("trend", api.settings.updateThresholds);

  // Immediate-apply, like theme/units/background — a "how I browse
  // activities" preference reads as a click-and-done toggle, not a form
  // field to explicitly Save. Updates saved+draft together so it never shows
  // up as a pending, unsaved change in the outlier-detection form below.
  async function setDetailView(view: Settings["activity_detail_view"]) {
    const updated = await api.settings.setDetailView(view);
    setSaved(updated);
    setDraft(updated);
    updateShared(updated); // propagate to ActivitiesTab, which reads this from the shared store
  }

  // One SaveBar per explicit-save card (Outlier detection, Overview & Trends).
  // Each has its own dirty state and its own save handler → persists only that
  // card's sub-resource (one card = one sub-resource, HRA-40).
  function SaveBar({ cardKey, dirty, onSave }: { cardKey: SaveKey; dirty: boolean; onSave: () => void }) {
    const saving = savingKey === cardKey;
    return (
      <div className="hra-row" style={{ gap: 10, marginTop: 4 }}>
        <button
          className="hra-btn"
          data-variant="cta"
          style={{ "--btn-color": "var(--accent-green)" } as CSSProperties}
          onClick={onSave}
          disabled={!dirty || saving}
        >
          {saving ? t("settings.savingEllipsis", "Saving…") : t("common.save", "Save")}
        </button>
        {justSavedKey === cardKey && !dirty && <span className="hra-text-success" style={{ fontSize: 12 }}>{t("settings.saved", "Saved")}</span>}
      </div>
    );
  }

  return (
    <div>
      {/* Background picture picker removed (2026-08-16 correction pass) —
          replaced by the app-wide automatic ambient glow layer (index.css's
          body::before: two radial accent/accent-glow washes over the theme
          base), which needs no per-user picking. See frontend.md's
          Appearance section.
          Three stacked rows (not the earlier 2-column grid): theme type,
          then accent (kept to one row — see AccentPicker), then the live
          chrome preview strip, each full-width so the row itself reads as
          one group rather than two side-by-side halves. */}
      <AccordionCard title={t("settings.appearance.title", "Appearance")} expanded={expanded === "appearance"} onToggle={() => toggle("appearance")}>
        <div style={{ marginBottom: 20 }}>
          <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 10 }}>{t("settings.appearance.themeLabel", "Theme")}</div>
          <ThemePicker appearance={appearance} />
        </div>
        <div>
          <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 10 }}>
            {t("settings.appearance.accentDescription", "Accent color — governs buttons, active pills, links and focus rings only; never chart/data colors")}
          </div>
          <AccentPicker appearance={appearance} />
        </div>
        <div style={{ marginTop: 20 }}>
          <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 10 }}>
            {t("settings.appearance.stylePackDescription", "Style pack — a full palette (background, borders, radius, shadows), independent of theme and accent")}
          </div>
          <StylePackPicker appearance={appearance} />
        </div>
        <ChromePreviewStrip />
      </AccordionCard>

      <AccordionCard title={t("settings.dateFormat.title", "Date format")} expanded={expanded === "dateFormat"} onToggle={() => toggle("dateFormat")}>
        <p className="hra-text-secondary" style={{ fontSize: 13, marginTop: 0, marginBottom: 12 }}>
          {t("settings.dateFormat.description", "Applies to every date shown in the app. \"Numeric\" is dd/mm or mm/dd depending on region; \"Literal\" spells the month out. Overview & Trends' chart axes always stay numeric (no room for a spelled-out month on a compact axis tick) but still follow the region here.")}
        </p>
        <DateFormatPicker appearance={appearance} />
      </AccordionCard>

      <AccordionCard title={t("settings.units.title", "Units")} expanded={expanded === "units"} onToggle={() => toggle("units")}>
        <p className="hra-text-secondary" style={{ fontSize: 13, marginTop: 0, marginBottom: 12 }}>
          {t("settings.units.description", "Applies to distance, pace, speed, elevation and weight everywhere in the app. \"Auto\" guesses from your browser's language/region (e.g. a US locale defaults to imperial) — there's no direct way for a web page to read the OS's actual measurement-system setting, so this is a best-effort default you can always override.")}
        </p>
        <UnitsPicker appearance={appearance} />
      </AccordionCard>

      <AccordionCard title={t("settings.activityDetails.title", "Activity details")} expanded={expanded === "activityDetails"} onToggle={() => toggle("activityDetails")}>
        <p className="hra-text-secondary" style={{ fontSize: 13, marginTop: 0, marginBottom: 12 }}>
          {t("settings.activityDetails.description", "How clicking an activity in the Activities tab opens its detail — expand inline in the list, or open as a popup.")}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          {(["accordion", "modal"] as const).map(v => {
            const selected = saved?.activity_detail_view === v;
            return (
              <button
                key={v}
                className="hra-toggle-pill"
                data-active={selected}
                onClick={() => setDetailView(v)}
              >
                {v === "accordion" ? t("settings.activityDetails.accordion", "Accordion (inline)") : t("settings.activityDetails.popup", "Popup")}
              </button>
            );
          })}
        </div>
      </AccordionCard>

      <AccordionCard title={t("settings.overviewTrends.title", "Overview & Trends")} expanded={expanded === "overviewTrends"} onToggle={() => toggle("overviewTrends")}>
        <p className="hra-text-secondary" style={{ fontSize: 13, marginTop: 0, marginBottom: 16 }}>
          {t("settings.overviewTrends.description", "Minimum activities needed before a sport's trend chart is shown (in \"Single\" mode), or before \"Week\"/\"Month\" grouping is offered — below this, a \"too few activities\" message is shown instead of a chart that would only have a couple of bars.")}
        </p>
        {draft && saved && (
          <>
            <SettingField
              label={t("settings.overviewTrends.fieldLabel", "Minimum activities/groups for a trend")}
              current={saved.min_trend_group_size}
              value={draft.min_trend_group_size}
              onChange={v => setDraft(d => d && { ...d, min_trend_group_size: Math.round(v) })}
              min={2} step={1}
            />
            <SaveBar cardKey="trend" dirty={trendDirty} onSave={saveThresholds} />
          </>
        )}
      </AccordionCard>

      <AccordionCard title={t("settings.outliers.title", "Outlier detection")} expanded={expanded === "outliers"} onToggle={() => toggle("outliers")}>
        <p className="hra-text-secondary" style={{ fontSize: 13, marginTop: 0, marginBottom: 16 }}>
          {t("settings.outliers.description", "Used by the activity chart's \"Remove outliers\" checkbox. Two independent rules: an isolated-spike filter (a point is flagged only when it jumps away and back from its neighbors faster than the rate below, so a genuine sustained change like a real sprint isn't affected), and an absolute floor for Speed/Pace — any sample slower than the walking-pace threshold is dropped outright, for a \"running only\" view.")}
        </p>

        {loading && <LoadingSpinner />}
        {error && <div style={{ marginBottom: 12 }}><ErrorBanner message={error} /></div>}

        {draft && saved && (
          <>
            <SettingField
              label={t("settings.outliers.speedFieldLabel", "Max speed change (m/s per second)")}
              current={saved.outlier_speed_delta_per_sec}
              value={draft.outlier_speed_delta_per_sec}
              onChange={v => setDraft(d => d && { ...d, outlier_speed_delta_per_sec: v })}
              min={0.1} step={0.1}
            />
            <div style={{ marginBottom: 4 }} />
            <SettingField
              label={t("settings.outliers.cadenceFieldLabel", "Max cadence change (steps/min per second)")}
              current={saved.outlier_cadence_delta_per_sec}
              value={draft.outlier_cadence_delta_per_sec}
              onChange={v => setDraft(d => d && { ...d, outlier_cadence_delta_per_sec: v })}
              min={1} step={1}
            />
            <div style={{ marginBottom: 4 }} />
            <div style={{ marginBottom: 14 }}>
              <label className="hra-text-secondary" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                {t("settings.outliers.minSpeedFieldLabel", "Min speed to count as running (km/h)")}
              </label>
              <div className="hra-row" style={{ gap: 10 }}>
                <input
                  type="number" min={0} step={0.5}
                  value={draft.outlier_min_speed_kmh}
                  onChange={e => setDraft(d => d && { ...d, outlier_min_speed_kmh: Number(e.target.value) })}
                  className="hra-input-narrow"
                />
                <span className="hra-text-muted" style={{ fontSize: 11 }}>
                  {draft.outlier_min_speed_kmh > 0 ? `≈ ${fmtMinSecRaw(60 / draft.outlier_min_speed_kmh)} min/km` : t("settings.outliers.off", "off")} · {t("settings.currentLabel", "current:")} <strong className="hra-text-secondary">{saved.outlier_min_speed_kmh}</strong>
                </span>
              </div>
            </div>

            <SaveBar cardKey="outliers" dirty={outliersDirty} onSave={saveOutliers} />
          </>
        )}
      </AccordionCard>
    </div>
  );
}
