# HRA-179 styling inventory

Captured from Git `HEAD` at implementation start on 2026-08-28, before HRA-179 source edits.

## Scope and method

The approved slice covers the non-analytics application shell/navigation, date-range controls, settings, classification workflows, all manage workflows, and training-plan list/calendar/editor surfaces. The inventory includes `App.tsx`, `DateRangeBar.tsx`, `SettingsTab.tsx`, `ClassificationCard.tsx`, `TrainingPlanAccordion.tsx`, `ManageTab.tsx`, `PlansTab.tsx`, and every non-test `components/manage/**/*.tsx` file recursively.

For each file, the baseline was read independently from `git show HEAD:<path>`; every line containing a JSX `style=` attribute was recorded below. The baseline contains **311 sites across 22 files**. Each site was treated as a migration candidate until individually classified.

## Baseline counts

| File | Sites |
|---|---:|
| `garmin-dashboard/src/App.tsx` | 5 |
| `garmin-dashboard/src/components/DateRangeBar.tsx` | 11 |
| `garmin-dashboard/src/components/SettingsTab.tsx` | 28 |
| `garmin-dashboard/src/components/ClassificationCard.tsx` | 26 |
| `garmin-dashboard/src/components/TrainingPlanAccordion.tsx` | 39 |
| `garmin-dashboard/src/components/manage/ClassifySection.tsx` | 19 |
| `garmin-dashboard/src/components/manage/DateRangesSection.tsx` | 17 |
| `garmin-dashboard/src/components/manage/DeleteSection.tsx` | 24 |
| `garmin-dashboard/src/components/manage/OAuthSyncSection.tsx` | 5 |
| `garmin-dashboard/src/components/manage/PlanInstanceAnchorTable.tsx` | 10 |
| `garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx` | 14 |
| `garmin-dashboard/src/components/manage/PlanInstanceEditorActions.tsx` | 5 |
| `garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx` | 18 |
| `garmin-dashboard/src/components/manage/PlanInstanceRow.tsx` | 9 |
| `garmin-dashboard/src/components/manage/PlanInstancesSection.tsx` | 8 |
| `garmin-dashboard/src/components/manage/PlanTemplateHelpModal.tsx` | 8 |
| `garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx` | 39 |
| `garmin-dashboard/src/components/manage/SyncAllBar.tsx` | 4 |
| `garmin-dashboard/src/components/manage/TrashList.tsx` | 11 |
| `garmin-dashboard/src/components/manage/TrashSection.tsx` | 3 |
| `garmin-dashboard/src/components/manage/UploadSection.tsx` | 5 |
| `garmin-dashboard/src/components/manage/plan-instances/PlanInstanceConfirmations.tsx` | 3 |
| **Total** | **311** |

## Baseline site snapshot

```text
garmin-dashboard/src/App.tsx:113: <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
garmin-dashboard/src/App.tsx:152: style={{
garmin-dashboard/src/App.tsx:169: <main style={{ flex: 1, maxWidth: 1240, width: "100%", margin: "0 auto", padding: "24px 24px 48px" }}>
garmin-dashboard/src/App.tsx:172: <div style={{ marginBottom: 20 }}>
garmin-dashboard/src/App.tsx:183: <div style={{ marginBottom: 20 }}>
garmin-dashboard/src/components/DateRangeBar.tsx:82: <span className="hra-text-primary" style={{ fontSize: 13, fontWeight: 600 }}>{t("dateRange.current", "Current")}</span>
garmin-dashboard/src/components/DateRangeBar.tsx:83: <label className="hra-text-secondary" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
garmin-dashboard/src/components/DateRangeBar.tsx:106: <span className="hra-text-muted" style={orStyle}>or</span>
garmin-dashboard/src/components/DateRangeBar.tsx:108: <span className="hra-text-muted" style={orStyle}>→</span>
garmin-dashboard/src/components/DateRangeBar.tsx:110: <span className="hra-text-muted" style={orStyle}>or</span>
garmin-dashboard/src/components/DateRangeBar.tsx:132: <div style={{ opacity: compare.enabled ? 1 : 0.4, pointerEvents: compare.enabled ? "auto" : "none" }}>
garmin-dashboard/src/components/DateRangeBar.tsx:133: <div className="hra-text-primary" style={{ fontSize: 13, fontWeight: 600, marginTop: 8, marginBottom: 6 }}>{t("dateRange.comparedTo", "Compared to")}</div>
garmin-dashboard/src/components/DateRangeBar.tsx:141: <div aria-hidden="true" style={{ display: "contents" }}>
garmin-dashboard/src/components/DateRangeBar.tsx:149: <span className="hra-text-muted" style={{ ...orStyle, visibility: "hidden" }}>or</span>
garmin-dashboard/src/components/DateRangeBar.tsx:152: <span className="hra-text-muted" style={orStyle}>→</span>
garmin-dashboard/src/components/DateRangeBar.tsx:154: <span className="hra-text-muted" style={orStyle}>or</span>
garmin-dashboard/src/components/SettingsTab.tsx:89: <div className="hra-chip-row" style={{ gap: 10 }}>
garmin-dashboard/src/components/SettingsTab.tsx:150: <div className="hra-chip-row" style={{ gap: 10 }}>
garmin-dashboard/src/components/SettingsTab.tsx:178: <span className="hra-pill hra-pill-active" style={{ padding: "5px 14px", fontWeight: 600 }}>
garmin-dashboard/src/components/SettingsTab.tsx:181: <a href="#" onClick={e => e.preventDefault()} style={{ fontSize: 12 }}>{t("settings.appearance.previewLink", "Link")}</a>
garmin-dashboard/src/components/SettingsTab.tsx:214: <span className="hra-text-muted" style={{ fontSize: 11 }}>
garmin-dashboard/src/components/SettingsTab.tsx:241: {t(`settings.dateFormat.${opt.value}`, opt.label)} <span style={{ opacity: 0.7 }}>· {opt.example}</span>
garmin-dashboard/src/components/SettingsTab.tsx:255: <div style={{ marginBottom: 14 }}>
garmin-dashboard/src/components/SettingsTab.tsx:256: <label className="hra-text-secondary" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
garmin-dashboard/src/components/SettingsTab.tsx:259: <div className="hra-row" style={{ gap: 10 }}>
garmin-dashboard/src/components/SettingsTab.tsx:266: <span className="hra-text-muted" style={{ fontSize: 11 }}>
garmin-dashboard/src/components/SettingsTab.tsx:365: <div className="hra-row" style={{ gap: 10, marginTop: 4 }}>
garmin-dashboard/src/components/SettingsTab.tsx:369: style={{ "--btn-color": "var(--accent-green)" } as CSSProperties}
garmin-dashboard/src/components/SettingsTab.tsx:375: {justSavedKey === cardKey && !dirty && <span className="hra-text-success" style={{ fontSize: 12 }}>{t("settings.saved", "Saved")}</span>}
garmin-dashboard/src/components/SettingsTab.tsx:393: <div style={{ marginBottom: 20 }}>
garmin-dashboard/src/components/SettingsTab.tsx:394: <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 10 }}>{t("settings.appearance.themeLabel", "Theme")}</div>
garmin-dashboard/src/components/SettingsTab.tsx:398: <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 10 }}>
garmin-dashboard/src/components/SettingsTab.tsx:407: <p className="hra-text-secondary" style={{ fontSize: 13, marginTop: 0, marginBottom: 12 }}>
garmin-dashboard/src/components/SettingsTab.tsx:414: <p className="hra-text-secondary" style={{ fontSize: 13, marginTop: 0, marginBottom: 12 }}>
garmin-dashboard/src/components/SettingsTab.tsx:421: <p className="hra-text-secondary" style={{ fontSize: 13, marginTop: 0, marginBottom: 12 }}>
garmin-dashboard/src/components/SettingsTab.tsx:442: <p className="hra-text-secondary" style={{ fontSize: 13, marginTop: 0, marginBottom: 16 }}>
garmin-dashboard/src/components/SettingsTab.tsx:460: <p className="hra-text-secondary" style={{ fontSize: 13, marginTop: 0, marginBottom: 16 }}>
garmin-dashboard/src/components/SettingsTab.tsx:465: {error && <div style={{ marginBottom: 12 }}><ErrorBanner message={error} /></div>}
garmin-dashboard/src/components/SettingsTab.tsx:476: <div style={{ marginBottom: 4 }} />
garmin-dashboard/src/components/SettingsTab.tsx:484: <div style={{ marginBottom: 4 }} />
garmin-dashboard/src/components/SettingsTab.tsx:485: <div style={{ marginBottom: 14 }}>
garmin-dashboard/src/components/SettingsTab.tsx:486: <label className="hra-text-secondary" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
garmin-dashboard/src/components/SettingsTab.tsx:489: <div className="hra-row" style={{ gap: 10 }}>
garmin-dashboard/src/components/SettingsTab.tsx:496: <span className="hra-text-muted" style={{ fontSize: 11 }}>
garmin-dashboard/src/components/ClassificationCard.tsx:125: <div className="hra-border" style={{ flex: "1 1 240px", minWidth: 220, borderRadius: 8, padding: 10 }}>
garmin-dashboard/src/components/ClassificationCard.tsx:126: <div className="hra-row" style={{ gap: 8 }}>
garmin-dashboard/src/components/ClassificationCard.tsx:127: <span className="hra-text-secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
garmin-dashboard/src/components/ClassificationCard.tsx:130: <div style={{ flex: 1 }} />
garmin-dashboard/src/components/ClassificationCard.tsx:145: <div className="hra-text-muted" style={{ fontSize: 10, textAlign: "right", marginTop: 2 }}>
garmin-dashboard/src/components/ClassificationCard.tsx:150: <div style={{ marginTop: 8 }}>
garmin-dashboard/src/components/ClassificationCard.tsx:152: <span className="hra-dyn-border hra-dyn-color" style={{
garmin-dashboard/src/components/ClassificationCard.tsx:162: <span className="hra-text-muted" style={{ fontSize: 12 }}>{t("activity.classify.notYetClassified", "Not yet classified")}</span>
garmin-dashboard/src/components/ClassificationCard.tsx:166: {explanation && <div className="hra-text-secondary" style={{ fontSize: 12, marginTop: 6 }}>{explanation}</div>}
garmin-dashboard/src/components/ClassificationCard.tsx:169: <div className="hra-row" style={{ gap: 8, marginTop: 8 }}>
garmin-dashboard/src/components/ClassificationCard.tsx:172: style={{
garmin-dashboard/src/components/ClassificationCard.tsx:181: style={{
garmin-dashboard/src/components/ClassificationCard.tsx:191: <div className="hra-text-muted" style={{ fontSize: 11, marginTop: 6 }}>
garmin-dashboard/src/components/ClassificationCard.tsx:203: <div className="hra-border-top" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8, paddingTop: 8 }}>
garmin-dashboard/src/components/ClassificationCard.tsx:214: <select value={reason} onChange={e => setReason(e.target.value as CorrectionReason)} style={{ fontSize: 12 }}>
garmin-dashboard/src/components/ClassificationCard.tsx:218: <select value={corrected} onChange={e => setCorrected(e.target.value as WorkoutClassification)} style={{ fontSize: 12 }}>
garmin-dashboard/src/components/ClassificationCard.tsx:224: style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
garmin-dashboard/src/components/ClassificationCard.tsx:231: style={{ fontSize: 12, borderRadius: 6, padding: "4px 12px", background: "none", cursor: "pointer" }}>
garmin-dashboard/src/components/ClassificationCard.tsx:237: {error && <div style={{ marginTop: 8 }}><ErrorBanner message={error} /></div>}
garmin-dashboard/src/components/ClassificationCard.tsx:266: <div className="hra-control-row" style={{ gap: 10, marginBottom: 10 }}>
garmin-dashboard/src/components/ClassificationCard.tsx:268: <span className="hra-dyn-border hra-dyn-color" style={{
garmin-dashboard/src/components/ClassificationCard.tsx:278: <span className="hra-dyn-color" style={{ fontSize: 12, "--dyn-color": color, fontWeight: status === "pending" ? 600 : 400 } as CSSProperties}>
garmin-dashboard/src/components/ClassificationCard.tsx:282: <div style={{ flex: 1 }} />
garmin-dashboard/src/components/ClassificationCard.tsx:283: <div className="hra-border-strong" style={{ display: "inline-flex", borderRadius: 999, overflow: "hidden" }}
garmin-dashboard/src/components/ClassificationCard.tsx:288: style={{
garmin-dashboard/src/components/ClassificationCard.tsx:299: <div className="hra-chip-row" style={{ gap: 10 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:221: <span className="hra-text-danger" style={{ fontSize: 12 }} title={t("runplan.accordion.needsReviewBadge", "Needs review")}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:237: <span className="hra-text-warning" style={{ display: "inline-flex", alignItems: "center" }} title={t("manage.planInstances.unsavedChanges", "Unsaved changes")}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:246: <span className="hra-tooltip hra-text-muted" data-tooltip={note} style={{ fontSize: 12, cursor: "help" }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:260: <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flex: 1, gap: 10, minWidth: 0 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:261: <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:262: <span className="hra-text-secondary" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 400, flexShrink: 0 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:333: style={drag.swappable ? { cursor: "grab" } : undefined}
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:358: <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "center", columnGap: 8, rowGap: 6 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:366: <span className={`hra-day-date-badge ${categoryCatClass}`} style={{ gridRow: 1, gridColumn: 1 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:373: <span style={{ gridRow: 1, gridColumn: 2, minWidth: 0 }}>{workoutText}</span>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:380: style={{ gridRow: 1, gridColumn: 2, width: "100%", minWidth: 0, fontFamily: "monospace", fontSize: 13, padding: 6 }}
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:383: <span className="hra-text-secondary" style={{ gridRow: 1, gridColumn: 3, display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:394: <span className="hra-text-secondary" style={{ gridRow: 2, gridColumn: 1, display: "flex", alignItems: "center" }} title={t(workoutTypeKey, workoutTypeFallback)}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:398: <div className="hra-segment" role="group" aria-label={t("runplan.accordion.workoutTypeSwitchLabel", "Day type")} style={{ gridRow: 2, gridColumn: 1, width: "100%" }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:407: style={{ flex: 1, padding: "4px 8px", display: "flex", alignItems: "center", justifyContent: "center" }}
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:416: day.notes && <div className="hra-text-muted" style={{ gridRow: 2, gridColumn: 2, minWidth: 0, fontSize: 12 }}>{day.notes}</div>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:424: style={{ gridRow: 2, gridColumn: 2, width: "100%", minWidth: 0, padding: 6, fontSize: 12 }}
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:428: <span className="hra-text-secondary" style={{ gridRow: 2, gridColumn: 3, fontSize: 12 }}>{scheduledTime}</span>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:436: style={{ gridRow: 2, gridColumn: 3, width: "100%", padding: 6, fontSize: 12 }}
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:442: <ul className="hra-text-danger" style={{ fontSize: 12, margin: "6px 0 0", paddingLeft: 18 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:447: <div className="hra-text-danger" style={{ fontSize: 12, marginTop: 6 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:477: <div {...drag.handlers} className={drag.isDragOver ? "hra-swap-drop-target" : undefined} style={drag.swappable ? { cursor: "grab" } : undefined}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:482: <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:488: <label className="hra-text-secondary" style={{ fontSize: 12 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:495: style={{ width: "100%", marginTop: 4, fontFamily: "monospace", fontSize: 12, padding: 6 }}
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:498: <label className="hra-text-secondary" style={{ fontSize: 12 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:505: style={{ width: "100%", marginTop: 4, padding: 6 }}
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:511: <ul className="hra-text-danger" style={{ fontSize: 12, margin: 0, paddingLeft: 18 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:516: <div className="hra-text-danger" style={{ fontSize: 12 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:576: <div {...drag.handlers} className={drag.isDragOver ? "hra-swap-drop-target" : undefined} style={drag.swappable ? { cursor: "grab" } : undefined}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:581: <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:583: <label className="hra-text-secondary" style={{ fontSize: 12 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:590: style={{ width: "100%", marginTop: 4, padding: 6 }}
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:643: <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:645: <div className="hra-text-muted" style={{ fontSize: 12 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:649: <label className="hra-text-secondary" style={{ fontSize: 12 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:655: style={{ width: "100%", marginTop: 4, padding: 6 }}
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:660: <label className="hra-text-secondary" style={{ fontSize: 12 }}>
garmin-dashboard/src/components/TrainingPlanAccordion.tsx:667: style={{ width: "100%", marginTop: 4, padding: 6 }}
garmin-dashboard/src/components/manage/ClassifySection.tsx:127: <div className="hra-block-title" style={{ marginBottom: 4 }}>{t("manage.classify.title", "AI workout classification")}</div>
garmin-dashboard/src/components/manage/ClassifySection.tsx:128: <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 12 }}>
garmin-dashboard/src/components/manage/ClassifySection.tsx:132: <div className="hra-control-row" style={{ gap: 8, marginBottom: 12 }}>
garmin-dashboard/src/components/manage/ClassifySection.tsx:134: <span className="hra-text-muted" style={{ fontSize: 12 }}>→</span>
garmin-dashboard/src/components/manage/ClassifySection.tsx:144: <div className="hra-text-muted" style={{ fontSize: 12, marginBottom: 12 }}>{t("manage.classify.noActivities", "No running activities in this range.")}</div>
garmin-dashboard/src/components/manage/ClassifySection.tsx:146: <div className="hra-border" style={{ maxHeight: 240, overflow: "auto", borderRadius: 6, padding: 8, marginBottom: 10 }}>
garmin-dashboard/src/components/manage/ClassifySection.tsx:147: <label className="hra-text-muted hra-border-bottom" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", marginBottom: 6, paddingBottom: 6 }}>
garmin-dashboard/src/components/manage/ClassifySection.tsx:166: <span key={key} className="hra-dyn-border hra-dyn-color" style={{
garmin-dashboard/src/components/manage/ClassifySection.tsx:184: <label key={a.id} className="hra-text-secondary hra-dyn-bg" style={{
garmin-dashboard/src/components/manage/ClassifySection.tsx:196: <span style={{ minWidth: 86 }}>{fmtDate(a.date_only)}</span>
garmin-dashboard/src/components/manage/ClassifySection.tsx:197: <span style={{ minWidth: 60 }}>{fmtKm(a.distance_m)}</span>
garmin-dashboard/src/components/manage/ClassifySection.tsx:199: <span className="hra-text-muted" style={{ fontSize: 10 }}>{t("manage.classify.unclassified", "unclassified")}</span>
garmin-dashboard/src/components/manage/ClassifySection.tsx:208: <div className="hra-border-strong" style={{ display: "inline-flex", borderRadius: 999, overflow: "hidden" }}
garmin-dashboard/src/components/manage/ClassifySection.tsx:213: style={{
garmin-dashboard/src/components/manage/ClassifySection.tsx:222: <div className="hra-border-strong" style={{ display: "inline-flex", borderRadius: 999, overflow: "hidden" }}
garmin-dashboard/src/components/manage/ClassifySection.tsx:227: style={{
garmin-dashboard/src/components/manage/ClassifySection.tsx:241: style={{ "--btn-color": "var(--accent-green)" } as CSSProperties}
garmin-dashboard/src/components/manage/ClassifySection.tsx:256: <div style={{ marginTop: 10 }}>
garmin-dashboard/src/components/manage/ClassifySection.tsx:260: {actionError && <div style={{ marginTop: 10 }}><ErrorBanner message={actionError} /></div>}
garmin-dashboard/src/components/manage/DateRangesSection.tsx:172: <div className="hra-block-title" style={{ marginBottom: 4 }}>{t("manage.dateRanges.title", "Named date ranges")}</div>
garmin-dashboard/src/components/manage/DateRangesSection.tsx:173: <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 12 }}>
garmin-dashboard/src/components/manage/DateRangesSection.tsx:178: <div style={rowStyle}>
garmin-dashboard/src/components/manage/DateRangesSection.tsx:186: style={nameInputStyle}
garmin-dashboard/src/components/manage/DateRangesSection.tsx:189: <span className="hra-text-muted" style={{ fontSize: 12 }}>→</span>
garmin-dashboard/src/components/manage/DateRangesSection.tsx:201: style={{ "--btn-color": "var(--accent-green)", ...actionButtonStyle } as CSSProperties}
garmin-dashboard/src/components/manage/DateRangesSection.tsx:211: <div style={rowStyle}>
garmin-dashboard/src/components/manage/DateRangesSection.tsx:220: <span className="hra-text-muted" style={{ fontSize: 12 }}>→</span>
garmin-dashboard/src/components/manage/DateRangesSection.tsx:232: style={{ "--btn-color": "var(--accent-green)", ...actionButtonStyle } as CSSProperties}
garmin-dashboard/src/components/manage/DateRangesSection.tsx:243: <div style={rowStyle}>
garmin-dashboard/src/components/manage/DateRangesSection.tsx:253: <span className="hra-text-danger" style={{ fontSize: 12 }}>{t("manage.dateRanges.confirmDeleteQuestion", "Delete this range?")}</span>
garmin-dashboard/src/components/manage/DateRangesSection.tsx:256: style={{ "--btn-color": "var(--accent-red)", ...actionButtonStyle } as CSSProperties}
garmin-dashboard/src/components/manage/DateRangesSection.tsx:263: style={{ fontSize: 12, borderRadius: 6, padding: "6px 12px", background: "none", cursor: "pointer" }}>
garmin-dashboard/src/components/manage/DateRangesSection.tsx:270: style={{ "--btn-color": "var(--accent-red)", ...actionButtonStyle } as CSSProperties}
garmin-dashboard/src/components/manage/DateRangesSection.tsx:280: {loading && <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("common.loading", "Loading…")}</div>}
garmin-dashboard/src/components/manage/DateRangesSection.tsx:281: {error   && <div className="hra-text-danger" style={{ fontSize: 12 }}>{error}</div>}
garmin-dashboard/src/components/manage/DateRangesSection.tsx:288: <div className="hra-status-msg" data-status="error" style={{ marginBottom: 12 }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:78: <div className="hra-block-title" style={{ marginBottom: 4 }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:79: {t("manage.delete.title", "Delete data range")} <span className="hra-text-muted" style={{ fontSize: 11, fontWeight: 400 }}>· {t("manage.delete.localOnly", "local database only")}</span>
garmin-dashboard/src/components/manage/DeleteSection.tsx:81: <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 16 }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:85: <div className="hra-control-row" style={{ gap: 16, marginBottom: 12 }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:86: <label className="hra-text-secondary" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:90: <label className="hra-text-secondary" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:97: style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: "transparent", cursor: "pointer" }}
garmin-dashboard/src/components/manage/DeleteSection.tsx:103: <div className="hra-control-row" style={{ gap: 8, marginBottom: 12 }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:105: <span className="hra-text-muted" style={{ fontSize: 12 }}>→</span>
garmin-dashboard/src/components/manage/DeleteSection.tsx:110: <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 10 }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:120: <label className="hra-text-secondary" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 10, cursor: "pointer" }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:127: <div className="hra-border" style={{ maxHeight: 160, overflow: "auto", marginBottom: 10, borderRadius: 6, padding: 8 }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:129: <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("common.loading", "Loading…")}</div>
garmin-dashboard/src/components/manage/DeleteSection.tsx:131: <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("manage.delete.noActivitiesInRange", "No activities in this range.")}</div>
garmin-dashboard/src/components/manage/DeleteSection.tsx:133: <div key={a.id} className="hra-text-secondary" style={{ fontSize: 12, padding: "3px 0" }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:141: <div className="hra-border" style={{ maxHeight: 160, overflow: "auto", marginBottom: 10, borderRadius: 6, padding: 8 }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:143: <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("common.loading", "Loading…")}</div>
garmin-dashboard/src/components/manage/DeleteSection.tsx:145: <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("manage.delete.noMeasurementsInRange", "No measurements in this range.")}</div>
garmin-dashboard/src/components/manage/DeleteSection.tsx:147: <div key={i} className="hra-text-secondary" style={{ fontSize: 12, padding: "3px 0" }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:157: style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
garmin-dashboard/src/components/manage/DeleteSection.tsx:164: <span className="hra-text-danger" style={{ fontSize: 12 }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:169: style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
garmin-dashboard/src/components/manage/DeleteSection.tsx:176: style={{ background: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }}>
garmin-dashboard/src/components/manage/DeleteSection.tsx:182: {result && <div className="hra-text-success" style={{ marginTop: 10, fontSize: 12 }}>{result}</div>}
garmin-dashboard/src/components/manage/OAuthSyncSection.tsx:119: <div className="hra-block-title" style={{ marginBottom: 4 }}>{t("manage.oauth.syncTitle", `Sync ${label} ${noun}`, { label, noun })}</div>
garmin-dashboard/src/components/manage/OAuthSyncSection.tsx:120: <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 12 }}>
garmin-dashboard/src/components/manage/OAuthSyncSection.tsx:137: <div style={{ marginBottom: 12 }}>
garmin-dashboard/src/components/manage/OAuthSyncSection.tsx:156: style={{ "--btn-color": "var(--accent-green)" } as CSSProperties}
garmin-dashboard/src/components/manage/OAuthSyncSection.tsx:166: <div className="hra-status-msg" data-status={status === "error" ? "error" : undefined} style={{ marginTop: 12 }}>
garmin-dashboard/src/components/manage/PlanInstanceAnchorTable.tsx:52: <div className="hra-text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
garmin-dashboard/src/components/manage/PlanInstanceAnchorTable.tsx:58: <div className="hra-anchor-table-wrap" style={{ marginBottom: 8 }}>
garmin-dashboard/src/components/manage/PlanInstanceAnchorTable.tsx:62: <th rowSpan={2} style={{ verticalAlign: "bottom" }}>{t("manage.planInstances.colAnchor", "Anchor")}</th>
garmin-dashboard/src/components/manage/PlanInstanceAnchorTable.tsx:65: <th rowSpan={2} style={{ verticalAlign: "bottom" }}></th>
garmin-dashboard/src/components/manage/PlanInstanceAnchorTable.tsx:66: <th rowSpan={2} style={{ verticalAlign: "bottom" }}>{t("manage.planInstances.colStatus", "Status")}</th>
garmin-dashboard/src/components/manage/PlanInstanceAnchorTable.tsx:106: <input type="text" className="hra-border-strong hra-bg-card hra-text-primary" value={row.absoluteValue} onChange={e => setAnchorAbsolute(anchor, e.target.value)} disabled={absoluteDisabled} placeholder={t("manage.planInstances.anchorAbsolutePlaceholder", "e.g. 5:10/km")} style={{ width: "100%", padding: "0 8px" }} />
garmin-dashboard/src/components/manage/PlanInstanceAnchorTable.tsx:125: <input className="hra-border-strong hra-bg-card hra-text-primary" value={row.seconds} onChange={e => setAnchorSeconds(anchor, e.target.value)} disabled={relativeDisabled} type="number" placeholder="—" style={{ width: "100%", padding: "0 8px" }} />
garmin-dashboard/src/components/manage/PlanInstanceAnchorTable.tsx:130: style={{ background: "none", borderRadius: 5, padding: "5px 10px", fontSize: 11, cursor: "pointer" }}
garmin-dashboard/src/components/manage/PlanInstanceAnchorTable.tsx:150: <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 14 }}>
garmin-dashboard/src/components/manage/PlanInstanceAnchorTable.tsx:154: <div style={{ fontSize: 11, color: unresolvedAnchors.length > 0 ? "var(--accent-red)" : "var(--text-muted)", marginBottom: 14 }}>
garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx:269: <span className="hra-agenda-event-main-row" style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, width: "100%" }}>
garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx:270: <span title={categoryLabel} style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, color: "var(--cat-color)" }}>
garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx:282: style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}
garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx:294: <span className="hra-agenda-gauge-ring" style={{ "--gauge-pct": distancePct, "--gauge-fill": "var(--data-pace)" } as CSSProperties} />
garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx:308: <span className="hra-agenda-gauge-ring" style={{ "--gauge-pct": durationPct, "--gauge-fill": "var(--accent-green)" } as CSSProperties} />
garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx:314: <span className="hra-agenda-gauge-ring" style={{ "--gauge-pct": intensityPct, "--gauge-fill": intensityColor } as CSSProperties} />
garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx:377: <label className="hra-text-secondary" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx:384: style={{ padding: 6, fontSize: 13 }}
garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx:432: type="button" className="hra-btn" data-variant="outline" style={ICON_BTN_STYLE}
garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx:451: <td className="hra-agenda-category-reference-icon" style={{ color: "var(--cat-color, var(--text-muted))" }}>
garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx:523: <button type="button" className="hra-btn" data-variant="outline" style={ICON_BTN_STYLE} onClick={() => onNavigate("PREV")} aria-label={t("manage.planInstances.calendarPrevious", "Previous month")}>
garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx:529: <button type="button" className="hra-btn" data-variant="outline" style={ICON_BTN_STYLE} onClick={() => onNavigate("NEXT")} aria-label={t("manage.planInstances.calendarNext", "Next month")}>
garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx:656: <div className="hra-agenda-calendar" style={{ height: 560 }}>
garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx:666: style={{ height: "100%" }}
garmin-dashboard/src/components/manage/PlanInstanceEditorActions.tsx:48: <div className="hra-row-wrap" style={{ marginBottom: 12, alignItems: "center" }}>
garmin-dashboard/src/components/manage/PlanInstanceEditorActions.tsx:80: style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
garmin-dashboard/src/components/manage/PlanInstanceEditorActions.tsx:83: <span onClick={e => e.stopPropagation()} style={{ display: "inline-flex" }}>
garmin-dashboard/src/components/manage/PlanInstanceEditorActions.tsx:93: <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }} onClick={() => onRestoreClick(isDirty)}>
garmin-dashboard/src/components/manage/PlanInstanceEditorActions.tsx:102: <div className="hra-segment" style={{ marginLeft: "auto" }}>
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:78: <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 6 }}>
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:89: <input type="text" className="hra-border-strong hra-bg-card hra-text-primary" value={instName} onChange={e => setInstName(e.target.value)} disabled={fieldDisabled} style={{ width: "100%", padding: "0 10px" }} />
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:92: <input type="text" className="hra-border-strong hra-bg-card hra-text-primary" value={raceName} onChange={e => setRaceName(e.target.value)} disabled={fieldDisabled} placeholder={t("common.optional", "Optional")} style={{ width: "100%", padding: "0 10px" }} />
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:98: <input type="text" className="hra-border-strong hra-bg-card hra-text-primary" value={raceUrl} onChange={e => setRaceUrl(e.target.value)} disabled={fieldDisabled} placeholder={t("manage.planInstances.linkRacePlaceholder", "e.g. https://www.baa.org/races/boston-marathon")} style={{ width: "100%", padding: "0 10px" }} />
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:101: <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 16 }}>
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:107: <div style={{ display: "grid", gridTemplateColumns: "160px 160px 220px", gap: 10, marginBottom: 6 }}>
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:117: style={{ width: "100%", padding: "0 10px" }}
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:125: style={{ width: "100%", padding: "0 10px" }}
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:129: <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 4 }}>
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:132: <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 16 }}>
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:136: <div className="hra-text-warning" style={{ fontSize: 11, marginBottom: 16 }}>
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:143: <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24, marginBottom: 6 }}>
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:160: <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:166: inputMode="numeric" maxLength={8} style={{ width: 90 }}
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:176: <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 14 }}>
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:181: <div style={{ marginBottom: 16 }}>
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:183: <input className="hra-border-strong hra-bg-card hra-text-primary" value={distanceM} onChange={e => setDistanceM(e.target.value)} disabled={fieldDisabled} type="number" style={{ width: 200, padding: "0 10px" }} placeholder={t("manage.planInstances.distancePlaceholder", "e.g. 21097")} />
garmin-dashboard/src/components/manage/PlanInstanceFormFields.tsx:188: <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 16 }}>
garmin-dashboard/src/components/manage/PlanInstanceRow.tsx:35: style={{ display: "inline-flex", alignItems: "center" }}
garmin-dashboard/src/components/manage/PlanInstanceRow.tsx:42: <span className="hra-text-secondary" style={{ fontSize: 11, fontStyle: "italic" }}>
garmin-dashboard/src/components/manage/PlanInstanceRow.tsx:49: <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
garmin-dashboard/src/components/manage/PlanInstanceRow.tsx:50: <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{instance.name ?? t("manage.planInstances.untitled", "Untitled instance")}</span>
garmin-dashboard/src/components/manage/PlanInstanceRow.tsx:51: {instance.event && <span className="hra-text-muted" style={{ fontSize: 11 }}>{t(`manage.planTemplates.event.${instance.event}`, instance.event)}</span>}
garmin-dashboard/src/components/manage/PlanInstanceRow.tsx:52: <span className="hra-text-muted" style={{ fontSize: 11 }}>{instance.start_date}</span>
garmin-dashboard/src/components/manage/PlanInstanceRow.tsx:60: <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
garmin-dashboard/src/components/manage/PlanInstanceRow.tsx:81: <div style={{ position: "relative" }}>
garmin-dashboard/src/components/manage/PlanInstanceRow.tsx:90: style={{ position: "absolute", top: 15, right: 46, zIndex: 1, padding: "4px 8px", display: "inline-flex", alignItems: "center" }}
garmin-dashboard/src/components/manage/PlanInstancesSection.tsx:45: <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
garmin-dashboard/src/components/manage/PlanInstancesSection.tsx:825: <div style={{ marginBottom: 12 }}>
garmin-dashboard/src/components/manage/PlanInstancesSection.tsx:860: <div className="hra-block-title" style={{ marginBottom: 4 }}>{t("manage.planInstances.title", "Training-plan instances")}</div>
garmin-dashboard/src/components/manage/PlanInstancesSection.tsx:861: <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 12 }}>
garmin-dashboard/src/components/manage/PlanInstancesSection.tsx:867: <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("manage.planInstances.loading", "Loading…")}</div>
garmin-dashboard/src/components/manage/PlanInstancesSection.tsx:869: <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
garmin-dashboard/src/components/manage/PlanInstancesSection.tsx:882: <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("manage.planInstances.empty", "No instances created yet.")}</div>
garmin-dashboard/src/components/manage/PlanInstancesSection.tsx:904: <div className="hra-text-muted" style={{ fontSize: 11, marginTop: 6 }}>{t("manage.planInstances.noTemplates", "Save a template first — an instance is always created from one.")}</div>
garmin-dashboard/src/components/manage/PlanTemplateHelpModal.tsx:135: style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }}
garmin-dashboard/src/components/manage/PlanTemplateHelpModal.tsx:140: style={{ borderRadius: 16, width: "100%", maxWidth: 640, maxHeight: "85vh", overflowY: "auto", padding: 24 }}
garmin-dashboard/src/components/manage/PlanTemplateHelpModal.tsx:143: <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
garmin-dashboard/src/components/manage/PlanTemplateHelpModal.tsx:149: style={{ background: "none", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}
garmin-dashboard/src/components/manage/PlanTemplateHelpModal.tsx:156: <div key={i} style={{ marginBottom: 18 }}>
garmin-dashboard/src/components/manage/PlanTemplateHelpModal.tsx:157: <div className="hra-text-primary" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{section.heading}</div>
garmin-dashboard/src/components/manage/PlanTemplateHelpModal.tsx:158: <div className="hra-text-secondary" style={{ fontSize: 12, lineHeight: 1.6 }}>{section.body}</div>
garmin-dashboard/src/components/manage/PlanTemplateHelpModal.tsx:162: style={{ marginTop: 8, padding: 10, borderRadius: 8, fontFamily: "monospace", fontSize: 11, overflowX: "auto", whiteSpace: "pre" }}
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:538: style={{ display: "inline-flex", alignItems: "center" }}
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:545: <span className="hra-text-secondary" style={{ fontSize: 11, fontStyle: "italic" }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:553: <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:554: <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tpl.name}</span>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:555: {tpl.event && <span className="hra-text-muted" style={{ fontSize: 11 }}>{t(`manage.planTemplates.event.${tpl.event}`, tpl.event)}</span>}
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:576: <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:577: <label className="hra-text-secondary" style={{ fontSize: 12, flex: "0 0 400px" }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:583: style={{ width: "100%", marginTop: 4, padding: 6 }}
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:587: <label className="hra-text-secondary" style={{ fontSize: 12, flex: "0 0 auto" }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:589: <div style={{ marginTop: 4 }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:606: <label className="hra-text-secondary" style={{ fontSize: 12, flex: "0 0 auto" }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:608: <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:615: style={{ width: 100, padding: 6 }}
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:625: <label className="hra-text-secondary" style={{ fontSize: 12, display: "block", marginBottom: 6 }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:632: style={{ width: "100%", marginTop: 4, fontFamily: "monospace", fontSize: 12, padding: 8 }}
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:636: <div className="hra-row-wrap" style={{ marginBottom: 12 }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:637: <label className="hra-btn" style={{ cursor: "pointer" }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:640: type="file" accept=".txt,.csv" style={{ display: "none" }}
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:653: <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }} onClick={onRestoreClick}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:663: <ul className="hra-text-danger" style={{ fontSize: 12, marginBottom: 12 }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:679: <div className="hra-modal-backdrop" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }} onClick={cancelRestoreConfirm}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:680: <div className="hra-bg-surface hra-border" style={{ borderRadius: 12, width: "100%", maxWidth: 360, padding: 20 }} onClick={e => e.stopPropagation()}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:681: <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5, marginBottom: 16 }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:684: <div className="hra-row-wrap" style={{ justifyContent: "flex-end" }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:685: <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }} onClick={cancelRestoreConfirm}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:704: <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:706: <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }} onClick={() => setShowHelp(true)}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:710: <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 12 }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:717: <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("common.loading", "Loading…")}</div>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:719: <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:723: <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:735: <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("manage.planTemplates.empty", "No templates saved yet.")}</div>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:748: <div key={tpl.id} style={{ position: "relative" }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:757: style={{ position: "absolute", top: 15, right: 46, zIndex: 1, padding: "4px 8px", display: "inline-flex", alignItems: "center" }}
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:775: <div className="hra-modal-backdrop" style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 }} onClick={() => setDeleteConfirmId(null)}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:776: <div className="hra-bg-surface hra-border" style={{ borderRadius: 12, width: "100%", maxWidth: 360, padding: 20 }} onClick={e => e.stopPropagation()}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:777: <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5, marginBottom: 16 }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:780: <div className="hra-row-wrap" style={{ justifyContent: "flex-end" }}>
garmin-dashboard/src/components/manage/PlanTemplatesSection.tsx:781: <button className="hra-border-strong hra-text-secondary" style={{ background: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" }} onClick={() => setDeleteConfirmId(null)}>
garmin-dashboard/src/components/manage/SyncAllBar.tsx:90: <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
garmin-dashboard/src/components/manage/SyncAllBar.tsx:93: <div className="hra-text-secondary" style={{ fontSize: 12 }}>
garmin-dashboard/src/components/manage/SyncAllBar.tsx:102: style={{ "--btn-color": "var(--accent-green)", whiteSpace: "nowrap" } as CSSProperties}
garmin-dashboard/src/components/manage/SyncAllBar.tsx:108: <div className="hra-text-secondary" style={{ marginTop: 10, fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>
garmin-dashboard/src/components/manage/TrashList.tsx:46: <div style={{ marginBottom: 16 }}>
garmin-dashboard/src/components/manage/TrashList.tsx:47: <div className="hra-block-title" style={{ fontSize: 13, marginBottom: 8 }}>{title}</div>
garmin-dashboard/src/components/manage/TrashList.tsx:48: {loading && <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("common.loading", "Loading…")}</div>}
garmin-dashboard/src/components/manage/TrashList.tsx:51: <div className="hra-text-muted" style={{ fontSize: 12 }}>{t("manage.trash.empty", "Trash is empty.")}</div>
garmin-dashboard/src/components/manage/TrashList.tsx:55: <div className="hra-border" style={{ maxHeight: 200, overflow: "auto", borderRadius: 6, padding: 8, marginBottom: 10 }}>
garmin-dashboard/src/components/manage/TrashList.tsx:56: <label className="hra-text-muted hra-border-bottom" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", marginBottom: 6, paddingBottom: 6 }}>
garmin-dashboard/src/components/manage/TrashList.tsx:61: <label key={item.id} className="hra-text-secondary" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", padding: "3px 0" }}>
garmin-dashboard/src/components/manage/TrashList.tsx:76: style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
garmin-dashboard/src/components/manage/TrashList.tsx:84: <span className="hra-text-danger" style={{ fontSize: 12 }}>{t("manage.trash.confirmPurge", `Permanently delete ${selected.size} item(s)? This can't be undone.`, { n: selected.size })}</span>
garmin-dashboard/src/components/manage/TrashList.tsx:87: style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
garmin-dashboard/src/components/manage/TrashList.tsx:94: style={{ background: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }}>
garmin-dashboard/src/components/manage/TrashSection.tsx:36: <div className="hra-row" style={{ gap: 8, marginBottom: 4 }}>
garmin-dashboard/src/components/manage/TrashSection.tsx:42: style={{ background: "none", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", fontSize: 13, padding: "2px 5px", lineHeight: 1 }}
garmin-dashboard/src/components/manage/TrashSection.tsx:47: <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 16 }}>
garmin-dashboard/src/components/manage/UploadSection.tsx:53: <div className="hra-block-title" style={{ marginBottom: 4 }}>{t("manage.upload.title", "Sync Garmin activities")}</div>
garmin-dashboard/src/components/manage/UploadSection.tsx:54: <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 12 }}>
garmin-dashboard/src/components/manage/UploadSection.tsx:69: style={{ "--btn-color": "var(--accent-green)" } as CSSProperties}
garmin-dashboard/src/components/manage/UploadSection.tsx:78: <div style={{ marginTop: 14 }}>
garmin-dashboard/src/components/manage/UploadSection.tsx:90: <div className="hra-status-msg" data-status={status === "error" ? "error" : undefined} style={{ marginTop: 12 }}>
garmin-dashboard/src/components/manage/plan-instances/PlanInstanceConfirmations.tsx:29: <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5, marginBottom: 16 }}>
garmin-dashboard/src/components/manage/plan-instances/PlanInstanceConfirmations.tsx:66: <div className="hra-text-primary" style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
garmin-dashboard/src/components/manage/plan-instances/PlanInstanceConfirmations.tsx:69: <div className="hra-text-secondary" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 16 }}>
```

## Runtime CSS-variable exception inventory

After migration, exactly three inline style sites remain, all in `garmin-dashboard/src/components/manage/PlanInstanceCalendar.tsx`:

| Site | Runtime custom properties | Reason |
|---|---|---|
| Distance gauge ring | `--gauge-pct: distancePct` | Percentage is derived from each rendered workout against the visible plan's maximum distance. The fixed fill color is class-based. |
| Duration gauge ring | `--gauge-pct: durationPct` | Percentage is derived from each rendered workout against the visible plan's maximum duration. The fixed fill color is class-based. |
| Intensity gauge ring | `--gauge-pct: intensityPct`; `--gauge-fill: intensityColor` | Percentage and interpolated color are both computed from the current plan-wide speed range and therefore cannot be represented by a finite state class. |

No retained inline style contains a static layout, spacing, typography, border, shadow, or finite visual-state declaration.
