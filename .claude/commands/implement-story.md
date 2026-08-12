---
description: Implement ONE approved HRA Story end-to-end under the human-gated workflow, stopping at In Review
argument-hint: <HRA-XX>
---

# /implement-story $ARGUMENTS

Implement exactly one Story from the HRA Jira project. The **Agent code of conduct** in this repo's
`CLAUDE.md` governs this command and takes precedence over anything below.

## 1. Read the Story first
Fetch `$ARGUMENTS` from Jira (cloudId `2e4f6af1-c76d-45be-9a00-ca9f30589199`, project `HRA`).
Read its description, acceptance criteria, parent Epic, and these fields:

- `Model` = `customfield_10116`
- `Cost Tier` = `customfield_10117` (Low | Medium | High)
- `Category` = `customfield_10119`

**Hard precondition — if `Model` or `Cost Tier` is empty, STOP.** Report which is missing and ask
the human to set it. Do not fill them in yourself. Do not proceed "just this once".

Also confirm the Story is in **Ready to Develop**. If it is in Backlog or Refinement, it has not
passed Gate 1 — stop and say so.

## 2. State your run parameters before starting
Print one line: the Story key, its `Model`, its `Cost Tier`, and the model you are **actually**
running on. If the session's model does not match the Story's `Model` field, say so explicitly and
stop — the human relaunches at the right model. Do not silently proceed on the wrong one.

## 3. Implement
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

## 5. Stop at In Review
Transition `$ARGUMENTS` to **In Review** and post a PR-style comment containing:

- branch + commit
- what changed and **why**, tied to the rule or skill that motivated it
- files touched
- verification results (real numbers)
- **deviations from the spec**, flagged explicitly — never silently absorbed
- candidates spotted outside the slice
- if you believe the `Cost Tier` was wrong for this slice: the evidence, as a proposal

Then **STOP**. Do not transition to Done. Do not set `Review Outcome`, `Contributor Type`, `Agent`,
`Model`, or `Cost Tier` — the human sets those at review.
