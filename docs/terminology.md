# Terminology decision record

Source: Epic HRA-240 (parent), refined from prompt HRA-239. This is the single reviewable
mapping for every label change the epic proposes. Later Stories apply this table instead of
re-deciding wording; do not rename a label that isn't listed here.

**Nothing in this Story renames anything.** No component, locale value, enum, API field, or DB
identifier is changed by this Story. This document only records the plan and closes the
hardcoded-string gap (see "Hardcoded-string audit" below) so future rename Stories have a clean
substrate to work on.

## Label change table

| Old label | New label | Affected translation key(s) |
| --- | --- | --- |
| Training plans | Plans | `nav.trainingPlans` |
| Template | Plan template | `manage.planTemplatesSectionTitle`, `manage.planTemplates.title`, `manage.planInstances.templateLabel`, `manage.planInstances.templatePlaceholder`, `manage.planInstances.pickTemplateFirst`, `manage.planInstances.noTemplates`, `manage.planTemplates.help.overview.heading` (and other `manage.planTemplates.help.*` prose referencing "template") |
| Instance | Race plan or Generated plan | `manage.planInstancesSectionTitle`, `manage.planInstances.title`, `manage.planInstances.untitled`, `manage.planInstances.description` |
| New instance | Create race plan | `manage.planInstances.newInstance`, `manage.planInstances.instantiateTitle` |
| Instantiate template | Create plan from template | `manage.planInstances.createButton` ("Create instance"), `manage.planInstances.instantiateFailed`, `manage.planInstances.instantiateSucceeded` |
| Approve | **Activate** (decision below) | `manage.planTemplates.approveButton`, `manage.planTemplates.approveFailed`, `manage.planTemplates.approveSucceeded`, `manage.planTemplates.approved`, `manage.planTemplates.notApproved`, `manage.planInstances.approveFailed`, `manage.planInstances.approveSucceeded`, `manage.planInstances.approved`, `manage.planInstances.notApproved`, `manage.planTemplates.help.saveApprove.heading`, `manage.planTemplates.help.saveApprove.body`, `activity.classify.approveTooltip` (classification-approve, see note below) |
| DSL text | Workout plan text | `manage.planTemplates.dslSourceLabel`, `manage.planTemplates.generateFailed`, `manage.planTemplates.help.headerLines.heading`, `runplan.accordion.editRejectedNoDslChange` |
| Advanced DSL editor | DSL editor | *(no existing key found under this exact string — applies to a future dedicated advanced-editor label, not yet built)* |
| Overlapping | Overlay | `overview.view.overlap` |
| Distinct | Side by side | `overview.view.distinct` |
| Single | By activity | `overview.group.single`, `settings.overviewTrends.description` (mentions `"Single"` mode) |
| Week | By week | `overview.group.week`, `manage.planInstances.calendarWeek` |
| Month | By month | `overview.group.month`, `manage.planInstances.calendarMonth` |
| AI workout classification | Identify workout types | `manage.classifySectionTitle`, `manage.classify.title` |
| MTP bridge | Watch connection | mentioned only inline in `manage.upload.description` (diagnostic prose — see "Exempt strings") |
| DB | Local app data | mentioned only inline in `manage.upload.description` (diagnostic prose — see "Exempt strings") |
| Server connected | Data service ready | `app.serverConnected` |

Notes:
- `overview.noun.week` / `overview.noun.month` (plain plural nouns "weeks"/"months" used in prose,
  e.g. "N weeks of data") are a separate, lower-priority concern from the `overview.group.*` /
  `manage.planInstances.calendar*` toggle labels above; a rename Story should check both but they
  are not necessarily worded identically.
- `activity.classify.approveTooltip` / `.rejectTooltip` are about approving/rejecting a
  **classification verdict**, not a template/instance. They read fine as-is ("Confirm this card's
  classification…") and are not part of the Approve→Activate rename — flagged here only so a future
  Story doesn't sweep them in by a blind text search on "approve".

## Approve → Activate decision

**Resolved: `Activate`**, not `Approve` and not `Mark ready`.

The epic's own caveat says the label must be derived from what the state transition actually
guarantees, not from the audit's wording:

- *"If it freezes a version for personal use: `Activate`."*
- *"If another person signs it off: `Approve`."*
- *"If it merely passes validation: `Mark ready`."*

Code evidence — approval is unconditionally cleared on every edit, in both places it exists:

- `garmin-stats/src/repositories/plan-templates.repo.ts:18-19` — the template `update` statement
  always sets `approved_at = NULL`, with the comment *"approved_at is always cleared on update
  (HRA-113 gate 2: any edit revokes approval)"*.
- `garmin-stats/src/services/plan-instances.service.ts:94` and `:193-194` — `instances.clearApproval(instanceId)`
  is called on instance updates, with surrounding comments confirming edits clear approval
  (`plan-instances.service.ts:76-78`, `:109-111`).

This app is single-user with no second party who signs anything off — there is no reviewer
distinct from the author. What the button actually does is freeze the current saved version:
approving locks it, and *any* subsequent edit invalidates that lock and requires re-approving. That
is exactly what the epic defines as `Activate`, not a validation gate (`Mark ready`) and not a
second-party sign-off (`Approve`).

## Exempt strings

Per the epic: *"The internal terms can remain in help, diagnostics and developer-oriented
details."* The following are exempt from this rename pass:

- The word **DSL** itself, wherever it names the language/format rather than labeling a UI action
  (e.g. `manage.planTemplates.help.headerLines.heading` talks about "The DSL text" as a field name,
  but the underlying concept "DSL" as a grammar/format name stays — only the user-facing *label*
  for the text box changes, per the table above).
- `manage.upload.description` — explanatory/diagnostic prose describing internally how sync works
  ("Runs the PowerShell MTP bridge … import them into the DB"). This is "how it works" detail, not
  a UI label; per the epic guardrail it can stay as internal/diagnostic wording. If a future Story
  wants full consistency it may reword this sentence too, but it isn't required by the label table.
- `manage.classify.methodTooltip`, `manage.classify.description`, `manage.planTemplates.help.*`
  bodies, and other long-form explanatory copy that mentions a to-be-renamed term in passing (e.g.
  "template", "instance") as part of a sentence, not as the UI label itself. These get swept up
  naturally when the Story that renames the corresponding label edits its surrounding copy; they
  are not separately tracked here.
- Sport enum presentation (`.claude/rules/frontend-i18n.md`: *"Sport enum presentation remains a
  known separate gap"*) — out of scope for this epic entirely.

## Out of scope (per this Story)

- No actual label rewording — the table above is the plan, not the change.
- No enum, API, or DB identifier changes. `approved_at`, `clearApproval`, and all persisted values
  stay exactly as they are; only the user-facing label changes in a future Story.

## Hardcoded-string audit

Grepped `garmin-dashboard/src/components/**/*.{ts,tsx}` (excluding tests) for:

- Raw JSX text nodes (`>Some Text<` not wrapped in `{t(...)}` or a variable).
- Hardcoded `title=`, `placeholder=`, `aria-label=`, `alt=`, `label=` string literals.
- Thrown `Error(...)` messages whose `.message` is surfaced to the user (a user-visible catch
  fallback per `.claude/rules/frontend-i18n.md`).

**Result: one violation found and fixed.** `garmin-dashboard/src/components/manage/shared.ts`
threw `new Error("Sync ended without a result")` with a literal English string; its `.message` is
displayed verbatim to the user via `setMsg(e.message)` in `UploadSection.tsx`, bypassing `t()`.
Fixed by routing it through `i18next.t("manage.sync.noResult", "Sync ended without a result")`,
matching the file's existing pattern for its other thrown/returned user-facing strings. Added the
`manage.sync.noResult` key to both `en.json` and `it.json`.

Every other user-facing string in the components tree already routed through `t()`.

`en.json` and `it.json` key sets remain identical after the fix (676/676, no diff) — see
`.claude/rules/frontend-i18n.md`'s existing-key-set invariant.
