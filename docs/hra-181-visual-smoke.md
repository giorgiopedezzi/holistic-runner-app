# HRA-181 visual smoke record

Date: 2026-08-28 (Europe/Rome)

## Result

**Not executed — current-state visual evidence is unavailable.**

The API and Vite dashboard were reachable locally, but the configured in-app browser runtime reported
no available browser connections. The browser workflow forbids substituting an unrelated automation
surface, so no screenshot or visual pass is claimed. HRA-179's review record covers only a recent
1440×1200 shell/navigation check; HRA-180 explicitly records that browser QA was unavailable. Those
records do not prove the current HRA-181 build and are not counted as a pass.

## Required matrix

| Surface | Desktop · dark | Desktop · light | Narrow · dark | Narrow · light |
|---|---|---|---|---|
| Overview & Trends | Not executed | Not executed | Not executed | Not executed |
| Activities | Not executed | Not executed | Not executed | Not executed |
| Body | Not executed | Not executed | Not executed | Not executed |
| Data & Sync | Not executed | Not executed | Not executed | Not executed |
| Settings | Not executed | Not executed | Not executed | Not executed |

## Required focused checks

| Check | State |
|---|---|
| Graphite palette in dark and light themes | Not executed |
| Activity-detail modal and backdrop/close behavior | Not executed |
| Popover positioning and styling | Not executed |
| Date-picker calendar positioning and styling | Not executed |
| Overview representative trend charts | Not executed |
| Activity overlay and standalone metric charts | Not executed |
| Body primary, metric, and correlation charts | Not executed |
| Browser console free of rendering/runtime errors | Not executed |

## Automated evidence available

`bash scripts/verify.sh` passed typecheck, 241 Vitest tests, 6 style-checker contract tests, lint
(0 errors, 16 pre-existing warnings), the style invariant report, and the production build. This
evidence covers structure and behavior but does not replace browser pixel/layout verification.
