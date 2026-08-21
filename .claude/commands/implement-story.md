---
description: Implement ONE approved HRA Story end-to-end under the human-gated workflow, stopping at In Review
argument-hint: <HRA-XX>
---

# /implement-story $ARGUMENTS

Implement exactly one Story from the HRA Jira project. The **Agent code of conduct** in this repo's
`CLAUDE.md` governs this command and takes precedence over anything below.

## 1. Read the Story first
Fetch `$ARGUMENTS` from Jira (cloudId `2e4f6af1-c76d-45be-9a00-ca9f30589199`, project `HRA`).
Read its description, acceptance criteria, parent Epic, issue links (`issuelinks`), and these fields:

- `Model` = `customfield_10116`
- `Planned thinking effort` = `customfield_10117`
- `Category` = `customfield_10119`
- `Actual thinking effort` = `customfield_10152` — **not an instruction; you SET it at In Review**
  by the criteria in `CLAUDE.md`, never by impression.

**Hard precondition — if `Model` or `Planned thinking effort` is empty, STOP.** Report which is
missing and ask the human to set it. Do not fill them in yourself. Do not proceed "just this once".

Also confirm the Story is in **Ready to Develop**. If it is in Backlog or Refinement, it has not
passed Gate 1 — stop and say so.

**Hard precondition — no open blockers.** Read the issue's links (`issuelinks`): if it is
*blocked by* any issue that is **not in `Done`**, STOP and name the open blocker. A Story is not
startable while a dependency it is blocked by is still in flight — starting anyway builds on ground
that may still shift. An issue with no blockers, or whose every blocker is already `Done`, passes.
(Only the *is blocked by* direction gates; issues this one *blocks*, or plain *relates to* links, do
not.)

## 2. State your run parameters before starting
Print one line: the Story key, its `Model`, its `Planned thinking effort` **stated explicitly**, the
model you are **actually** running on, and what that effort level commits you to (see `CLAUDE.md` →
"`Model` and `Thinking effort` — what the values commit you to").

**Two launch preconditions — both are STOP conditions, symmetric with each other:**

- **Model.** If the session's model does not match the Story's `Model` field, say so and stop — the
  human relaunches at the right model. Never silently proceed on the wrong one.
- **Effort.** This run **assumes the session was launched at the Story's `Planned` effort.** Unlike
  the model, a running session **cannot reliably read its own runtime `/effort`** — no field or tool
  exposes it (established on HRA-85), so this is a *declared* precondition, not an automatic
  self-check. State the assumed launch effort on line one so the human can catch a mismatch you
  can't see; and if you *know* the session was launched at a different `/effort` than `Planned`
  (e.g. you set it this session), **STOP and relaunch** rather than run a mis-tiered slice. Never
  change your own effort mid-slice to compensate.

An unstated effort is an unfollowed effort.

**Transition to In Progress.** Once both preconditions above are clear, transition `$ARGUMENTS`
from Ready to Develop to **In Progress** before touching any file. The board should say work has
started at the moment it actually starts — not stay on Ready to Develop through the whole
implementation and jump straight to In Review, which is what happened before this rule existed.

**Create a dedicated Story branch.** Before touching any file, branch off the current HEAD:
`git checkout -b feature/hra-XX_brief-description` (lowercase, matching the existing convention).
Never implement directly on whatever branch happened to be checked out at session start — that
silently mixes this Story's commit into an unrelated branch's history (HRA-100).
Both comes before next step (3. Implement)

## 3. Implement
- **Read the area's `docs/` file first.** Before writing code in an area, read the file CLAUDE.md's
  routing table lists for it. If a file the table names appears missing, that is a **lookup error
  (wrong path, stale cwd) — not proof of absence**: find and read it before proceeding, never treat
  a listed area as undocumented. (This rule exists because HRA-67 skipped `docs/frontend.md` on a
  bad path and a trusted empty search result.)
- Only the slice this Story describes. The plan and acceptance criteria are already approved —
  do not re-plan, re-scope, or improve adjacent code.
- Apply the skill stack per `CLAUDE.md`'s manifest, in its stated precedence.
- Anything you spot outside the slice is a **candidate** for the writeup, never part of the diff.
- API contract / client-type changes → hand off to Epic **HRA-36**, do not implement here.

## 4. Verify before claiming anything
Run the checks that actually prove the acceptance criteria: typecheck both packages, the test
suites, and a live smoke where behaviour is observable. Report real numbers (`46/46 pass`), never
"tests pass". If something fails, say so with the output — a failing check reported honestly is
worth more than a green summary that isn't true.

**Frontend verification: `npm run verify`** (`garmin-dashboard/scripts/verify.sh`) runs
typecheck/test/lint/build in one call. Use it, don't retype the sequence inline — a repeated
compound command that captures `PIPESTATUS`/pipes/greps contains shell expansion, which the
permission harness can never allowlist (by design — expansion can't be statically proven safe). The
same rule applies to any future recurring verification command: put it in a named script invoked by
one clean call, not typed inline each run (HRA-88).

## 5. Stop at In Review
Transition `$ARGUMENTS` to **In Review** and post a PR-style comment containing:

- branch + commit
- what changed and **why**, tied to the rule or skill that motivated it
- files touched
- verification results (real numbers)
- **deviations from the spec**, flagged explicitly — never silently absorbed
- candidates spotted outside the slice
- **effort evidence + the value you set** — state the facts (passes taken, files you opened that the
  Story did not name, whether you stopped), then say which criterion fired and what you therefore
  set `Actual thinking effort` to. Facts first, value second, so the human can check one against
  the other.

**Set `Actual thinking effort` (`customfield_10152`)** by the criteria in `CLAUDE.md` — by rule, not
by impression. It is the only field you write.

**Check off the Acceptance Criteria items in the description that are met — nothing else in the
description changes.** Mark each genuinely-met item checked/DONE; leave anything not met open; never
check an item that isn't actually true. This is a checklist-state update, not license to rewrite the
Problem/Change/Rules sections — those are the approved spec (rule 5), untouched. The comment
explains *why*; the checklist reflects *what*, and only the checklist does (HRA-101).

⚠️ **The Acceptance Criteria list is a real Jira checklist (ADF `taskList`/`taskItem` nodes with a
`state: "TODO"|"DONE"` attribute) — not literal `- [ ]` text.** `editJiraIssue`'s markdown mode
(`contentFormat: "markdown"`, or omitted) does **not** parse GFM task-list syntax: sending a
`- [x] ...` string degrades the real checklist into a plain bullet list with the literal text
`[x] ...`, which then round-trips back out of Jira as escaped `* \[x\] ...` — silently destroying
the checklist while looking like a normal edit (confirmed HRA-115: it happened, was later corrected
by re-sending the description as real ADF). **`getJiraIssue` cannot show you the underlying ADF
either** — every `responseContentFormat` it's given (`markdown` or `adf`) comes back as the same
markdown-flattened string, so you cannot detect this failure by re-reading the issue afterward; the
tool will look like it worked.

**The fix: build the whole description as a real ADF document and send it via
`editJiraIssue(..., contentFormat: "adf", fields: {description: <ADF object, not a string>})`.**
Use `taskList`/`taskItem` (`attrs: {localId, state: "DONE"|"TODO"}`) for the Acceptance Criteria
section, and ordinary `heading`/`paragraph`/`orderedList`/`bulletList`/`text` nodes (with
`code`/`strong`/`em` marks for inline formatting) for everything else — reproducing the untouched
Problem/Change/scope sections verbatim, not just the checklist. This is the only path that survives
the round-trip; a markdown string, even a byte-perfect one, does not.

Then **STOP**. Do not transition to Done. Do not set `Review Outcome`, `Contributor Type`, `Agent`,
`Model`, or `Planned thinking effort` — the human sets those.
