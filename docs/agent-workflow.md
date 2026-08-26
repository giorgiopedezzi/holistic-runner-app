# Agent Story workflow and Jira reference

Read this document before executing a Story, writing Jira fields/comments/transitions, editing a Story checklist, or deciding `Actual thinking effort`.

The root `CLAUDE.md` owns the non-negotiable gates. This file contains the detailed mechanics and reference data that do not need to be resident in every coding session.

---

## Model, Planned effort, and Actual effort

Three fields have different owners:

- **Model (`customfield_10116`)** — human-selected and launch-bound. Read it, compare it with the actual running model, and STOP on mismatch. Never rewrite the field to match the session.
- **Planned thinking effort (`customfield_10117`)** — human-selected and launch-bound. Execute its behavioral commitments. Never change the runtime effort mid-slice.
- **Actual thinking effort (`customfield_10152`)** — agent-recorded measurement at In Review. Determine it by the objective criteria below, state which criterion fired, and let the human override if needed.

A running Claude Code session cannot reliably self-read its own `/effort`. The effort guard is therefore a declared launch precondition: state what effort the session was launched at and STOP if you know it differs from Planned.

### Actual effort decision rule

| Set `Actual`… | when ANY is true |
|---|---|
| **above Planned** | you read files the Story did not name · a fix took more than two attempts · you had to stop and ask · you discovered a constraint the Story did not mention |
| **below Planned** | no exploration beyond named files was needed · no alternative was seriously weighed · the first attempt passed its acceptance criteria unchanged |
| **equal to Planned** | neither list fired |

In the In Review comment report observable evidence: passes taken, unnamed files opened, where you stopped, and which criterion fired. The human verifies decision-field ownership and can override `Actual`; Jira history preserves who wrote what.

Both effort fields must expose the same ordered option values: `low < medium < high < xhigh < max`.

---

## Model choices

| Value | Use for |
|---|---|
| `claude-opus-5` | Planning, design, ambiguous specs, high blast radius; the approach itself is hard. |
| `claude-sonnet-5` | Implementing an approved slice whose acceptance criteria are the oracle. |

Default for approved implementation slices: **`claude-sonnet-5` + `medium`**.

---

## Planned effort behavior

Effort is a behavioral/deliberation dial, not a guaranteed spend cap.

### `low` — answer is obvious before starting

- Act directly; no extended plan.
- Touch only Story-named files.
- No exploration and no subagents.
- Run the existing suite.
- Do not improve adjacent code.

### `medium` — routine approved implementation/refactor

- State a one-paragraph plan before editing.
- Read the slice plus immediate callers.
- No subagents.
- Run suite + typecheck.
- Walk each acceptance criterion and state how it was met.

### `high` — real design choice exists inside the approved slice

- Think deeply and name at least one alternative plus why it was rejected in the review comment.
- Broad exploration is allowed.
- Read-only investigation subagents are permitted.
- Run suite + typecheck + live/manual check where behavior is observable.
- State what could still be wrong.

### `xhigh` — large multi-file change where coverage is the main risk

Everything in `high`, plus:

- Enumerate the full change set **before** editing and state the count.
- Work in verifiable batches.
- Re-run the enumeration at the end and prove the remaining count is zero using grep/AST evidence.
- Explicitly list deliberately skipped sites and reasons.

### `max` — brutal debugging or critical design flaw

Everything in `high`, plus:

- Form a hypothesis and try to falsify it before fixing.
- Cross-check with an independent method (parallel subagent or `llm-council`).
- No fix without a reproduction that fails before and passes after.
- Report what was ruled out and why.
- **If you cannot reproduce, STOP and report. Never fix blind.**

### Effort boundaries

- Every level assumes the Story is the right problem; questioning the problem itself is `Category = Research/Spike`, not “more effort.”
- Do not add orthogonal modes such as `ultrathink` to the ordered effort select; if recording such a mode is needed, use a label.
- More effort is not monotonically better.
- Never self-raise or self-lower effort mid-slice.
- If a gross mismatch is discovered **very early**, before the tier's front-loaded work is spent, STOP and ask. If discovered later, finish the slice and report the evidence.
- Correct systematic over/under-tiering through future human Planned choices, not agent self-adjustment mid-run.

---

## Story lifecycle

Kanban: Backlog → Refinement → Ready to Develop (Gate 1) → In Progress → In Review (Gate 2) → Done.

- Do not start unless Model + Planned are present.
- Implement only the approved slice.
- Stop at In Review and post a PR-style comment.
- Never transition to Done.
- One Story per invocation.
- Anything outside the approved slice becomes a candidate in the review comment, not code in the diff.

**Policy epoch:** these fields are mandatory for Stories entering Ready to Develop from **2026-08-12 ~17:30 CEST** onward. Nulls on older issues are pre-policy; never backfill them.

---

## Jira identifiers

Project: HRA

- cloudId: `2e4f6af1-c76d-45be-9a00-ca9f30589199`
- project id: `10067`
- issue types: Epic `10114`, Story `10117`
- transition to Done: `41` — agents must not use it for Story completion

### Decision/custom fields

| Field | ID | Notes/options |
|---|---|---|
| Contributor Type | `customfield_10114` | Human · AI · Hybrid; human-owned |
| Agent | `customfield_10115` | e.g. Claude Code; human-owned |
| Model | `customfield_10116` | e.g. `claude-sonnet-5`; human-owned |
| Planned thinking effort | `customfield_10117` | human-owned; multi-select; ordered values below |
| Actual thinking effort | `customfield_10152` | **agent writes at In Review**; multi-select; ordered values below |
| Review Outcome | `customfield_10118` | Accepted · Edited · Rejected; human-owned |
| Category | `customfield_10119` | single-select; classification rules below |

Prefer option IDs over labels when known; labels can be renamed and matching is case-sensitive.

#### Planned effort option IDs (`10117`)

- `low` = `10043`
- `medium` = `10044`
- `high` = `10045`
- `xhigh` = `10160`
- `max` = `10087`

#### Actual effort option IDs (`10152`)

- `low` = `10121`
- `medium` = `10122`
- `high` = `10123`
- `xhigh` = `10159`
- `max` = `10125`

**Both effort fields are multi-select.** Send them as arrays such as `[ { "id": "..." } ]`; a bare object fails.

Known Category options:

- Technical Improvement = `10049`
- Business Functionality = `10050`
- Enabler/Infrastructure = `10051`
- Research/Spike and Bug exist, but verify current exact casing/ID from live Jira before writing if not already known.

For any option previously marked casing-unverified, read a live issue before trusting an inherited label. IDs are preferred because admin label renames do not change them.

### Writing project-scoped custom fields

These custom fields may be absent from Jira create/edit metadata because they are not on the interactive create/edit screen, but they can still be written through the issue APIs where permitted.

- On create, use the API's `additional_fields` payload when appropriate.
- On edit, use `fields`.
- Select-option matching by label is case-sensitive; a casing mismatch can produce the same “Select a valid option” error as a nonexistent option.
- Prefer `{ "id": "<optionId>" }` over `{ "value": "<label>" }` when the option ID is known.
- The MCP/API tools cannot create new Jira select options; that is an admin action.

---

## Jira issue-link direction

For the `Blocks` link type:

- `inwardIssue` = the issue that **blocks**
- `outwardIssue` = the issue that **is blocked**

Example: “A is blocked by B” → `inwardIssue: B`, `outwardIssue: A`.

After creating a link, verify direction visually in Jira UI rather than reasoning again from the same ambiguous API representation.

---

## Jira Story checklist editing — ADF only

A Story description's Acceptance Criteria checklist is a real ADF `taskList` / `taskItem`, not Markdown `- [ ]` text.

- Never edit an existing real checklist by sending a Markdown description string.
- Markdown task-list syntax can silently degrade the checklist into ordinary bullets containing literal `[x]` text.
- Jira readback may flatten the representation and fail to reveal that corruption.
- To change checklist state, send the **entire description as real ADF** with `contentFormat: "adf"`, preserving all non-checklist sections and using `taskList` / `taskItem` nodes for the checklist.

---

## Category rule

First question: **does the runner/end user use or see this work?**

- Yes → `Business Functionality`.
- No → continue below.

Second question: **does this change product code, or the machinery that makes future delivery possible/cheaper?**

- Delivery machinery, repo/tooling/test infrastructure/context/governance → `Enabler/Infrastructure`.
- Product code with no direct user impact (refactor, plumbing, perf) → `Technical Improvement`.

### Research/Spike

Use `Research/Spike` when uncertainty is in the **question/problem framing**, not merely in how to implement an accepted solution.

For a Spike:

- State what would make this the wrong problem and what evidence would reveal that.
- Bring independent perspectives to the framing, not only the solution.
- Produce a recommendation plus its strongest counterargument.
- Name evidence that would change the recommendation.
- If the correct answer is “re-scope this,” say so and stop.

---

## Attribution convention

- Epics: `Contributor Type = Human`; Agent/Model blank.
- Stories: `Hybrid`.
- These are human decision fields. The agent reads them and obeys them but never writes them.
