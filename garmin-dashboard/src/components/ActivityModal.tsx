/**
 * ActivityModal.tsx
 * Full detail view for a single activity — shown when user clicks on an activity row.
 * Displays all fields + a multi-metric track chart (Speed/Pace pinned, plus optional
 * HR/altitude/cadence/power, overlaid with pause detection) + delete button.
 *
 * Decomposed into components/activity/ (HRA-74) — this file just re-exports
 * the same public surface at its original import path, since ActivitiesTab
 * and both Phase 0 test files (ActivityModal.test.tsx, activity-outliers.test.ts)
 * import from here.
 */
export { ActivityDetailBody } from "@/components/activity/ActivityDetailBody";
export { ActivityModal } from "@/components/activity/ActivityModal";

// Re-exported so the Phase 0 outlier tests (activity-outliers.test.ts, HRA-63)
// keep importing them from here unchanged after the move to domain/outliers.ts.
export { computeOutlierMask, computeMinSpeedMask } from "@/domain/outliers";
