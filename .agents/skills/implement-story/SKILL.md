---
name: implement-story
description: Execute exactly one approved HRA Jira Story end-to-end in this repository. Use when asked to implement, continue, execute, or finish a Jira Story. Do not use for Story creation, refinement, decomposition, or backlog planning.
---

# Implement one HRA Story

This skill is the Codex authority for Story execution and Jira workflow.

## Non-negotiable outcome

Execute exactly one approved Story on a dedicated Story branch, verify it, commit the verified Story changes, move it to **In Review**, post the review evidence including branch + commit, then STOP.

Never move a Story to Done.

## 1. Resolve the Story

Require one Jira Story key (for example `HRA-123`).

Use the configured Atlassian MCP server to read the issue and its current fields. If Jira cannot be read, STOP; do not implement a Story from memory or from a partial prompt.

## 2. Gate before any implementation work

Read and follow exactly:

`.agents/workflows/story-jira-gate.md`

Before checking Agent / Model / effort:

- for a **new implementation**, Jira status must be exactly `Ready to Develop`;
- `BACKLOG`/`Backlog` or `REFINEMENT`/`Refinement` → STOP;
- `In Review` or `Done` → STOP;
- `In Progress` is allowed only for an explicit continuation/resume of the same Story under the shared resume rule.

Never transition a Story into `Ready to Develop`.


For Stories subject to the current policy, require:

- `Agent` (`customfield_10115`) = **`Codex`**
- `Model` (`customfield_10116`) = one supported Codex/ChatGPT model:
  - `gpt-5.6-sol`
  - `gpt-5.6-terra`
  - `gpt-5.6-luna`
- `Planned thinking effort` (`customfield_10117`) = exactly one of:
  - `low`
  - `medium`
  - `high`
  - `xhigh`
  - `max`

Human-owned fields are read-only:
- `Contributor Type` (`10114`)
- `Agent` (`10115`)
- `Model` (`10116`)
- `Planned thinking effort` (`10117`)
- `Review Outcome` (`10118`)

Never write them.

### Runtime match

Treat Jira `Agent`, `Model`, and `Planned thinking effort` as **declared launch preconditions**.

The human launches Codex with the Jira-selected model and reasoning effort, and verifies the launch configuration in the Codex client/UI when available.

Runtime introspection from inside the agent context may be incomplete. In particular, `.codex/config.toml` contains **project defaults only**: CLI or UI overrides can supersede those values without modifying the file. Therefore:

- `Agent` mismatch → STOP.
- A **known** model mismatch → STOP.
- A **known** reasoning-effort mismatch → STOP.
- If concrete runtime evidence shows a mismatch, STOP.
- If you know you were launched with a different model or effort, STOP.
- If the active runtime override cannot be introspected, **proceed using the Jira Model and Planned effort as the declared launch configuration**. Absence of introspection is not a mismatch.
- Never infer the active runtime from `.codex/config.toml` when an override may have been supplied.
- Never change model or reasoning effort mid-Story to make the session match Jira.
- Never rewrite Jira to make it match the session.

**Current Codex-local caveat:** if Jira says `max` and the running Codex client does not expose/select `max`, STOP. Do not silently map `max` to `xhigh`.

Policy epochs:
- Model + Planned effort: mandatory for Stories entering Ready to Develop from `2026-08-12 ~17:30 CEST`.
- Agent: mandatory for Stories entering Ready to Develop from `2026-08-26`.
- Do not backfill pre-policy issues merely to satisfy a gate.

Your first output line must be:

`Agent: Codex · Model: <jira-model> · Planned effort: <jira-effort> — <one-sentence commitment>`

## 3. Establish the Story Git branch

Read and follow exactly:

`.agents/workflows/story-git-lifecycle.md`

After the Jira launch gate passes and before any source edit:

- verify the working tree is safe to use;
- create or reuse the dedicated Story branch required by the shared workflow;
- transition Jira from Ready to Develop to In Progress when applicable.

Do not begin implementation on the base branch.

## 4. Read before editing

Read:
1. `AGENTS.md`.
2. The Story description and Acceptance Criteria.
3. Every applicable `.claude/rules/*.md` from the routing table in `AGENTS.md`.
4. The relevant `docs/*.md` route from `AGENTS.md`.
5. The named files plus only the exploration allowed by the Planned effort.

Do not infer a file list from the repository skeleton when it can be verified.

## 5. Execute the Planned effort

The level is a behavioral commitment, not a spend target.

### low
- Act directly; no extended plan.
- Touch only files the Story names.
- No broad exploration or subagents.
- Run the existing relevant suite.
- Do not improve adjacent code.

### medium
- State a one-paragraph plan before editing.
- Read the approved slice plus immediate callers.
- No subagents.
- Run relevant suite + typecheck.
- Walk every Acceptance Criterion and state how it is met.

### high
- Name at least one real alternative and why it was rejected.
- Broad exploration is allowed.
- Read-only subagents are permitted when useful.
- Run suite + typecheck + a live/manual check wherever behavior is observable.
- State what could still be wrong.

### xhigh
Everything at `high`, plus:
- Before editing, enumerate the full intended change set and state the count.
- Work in verifiable batches.
- Re-run the enumeration at the end and prove the outstanding count is zero.
- List every deliberately skipped matching site with the reason.

### max
Everything at `high`, plus:
- Form a falsifiable hypothesis before fixing anything.
- Try to disprove it before choosing the fix.
- Cross-check with a genuinely independent method.
- No fix lands without a reproduction that fails before and passes after.
- Report what was ruled out and why.
- If the issue cannot be reproduced, STOP and report; never fix blind.

## 6. Scope discipline

- Implement only the Story slice and its approved Acceptance Criteria.
- Do not re-plan the Epic.
- Do not opportunistically clean up, modernize, or refactor adjacent code.
- Put worthwhile out-of-scope findings in the final review comment as **candidates**.
- API contract/client-type work belongs to HRA-36 unless the Story explicitly owns it.

## 7. Editing discipline

Follow `AGENTS.md` and all loaded path rules.

Use content-aware patch/edit operations. Never perform blind line-number source mutations.

## 8. Verification

Verification must be evidence, not “looks good”.

At minimum, obey the Planned effort's verification commitment and all applicable Acceptance Criteria.

Record:
- commands/checks run;
- passes/failures and repair attempts;
- files opened beyond those named by the Story;
- manual/live observations;
- any unresolved risk.

## 9. Determine Actual thinking effort objectively

`Actual thinking effort` is `customfield_10152`. It is the one effort field the agent writes.

First determine the relation to Planned:

### Above Planned if ANY is true
- you had to read files the Story did not name;
- a fix took more than two attempts;
- you had to stop and ask for missing information;
- you discovered a constraint the Story did not mention.

### Below Planned if ALL of these describe the work
- no exploration beyond the named files was needed;
- no alternative was seriously weighed;
- the first implementation attempt passed the Acceptance Criteria unchanged.

### Equal Planned
Use when neither list fires.

Map the relation to an exact option deterministically:
- equal → same rung as Planned;
- above → the **lowest higher rung** whose behavioral commitments match the work actually performed;
- below → the **highest lower rung** whose behavioral commitments still cover the work actually performed;
- never jump farther than the observed evidence requires.

Ordered ladder:
`low < medium < high < xhigh < max`

Actual option IDs:
- `low` = `10121`
- `medium` = `10122`
- `high` = `10123`
- `xhigh` = `10159`
- `max` = `10125`

The Jira field is multi-select. Write it as an array containing one option object, e.g. `[{"id":"10122"}]`.

State in the review comment exactly which objective criterion fired and the supporting facts.

## 10. Jira write safety

## Acceptance Criteria — Jira ADF action items

Read and follow:

`.agents/workflows/jira-acceptance-criteria.md`

Acceptance Criteria are real Jira ADF `taskList` / `taskItem` nodes.

During this Story:

- verify each Acceptance Criterion individually;
- mark only objectively verified criteria `DONE`;
- leave unproven criteria `TODO`;
- preserve the full description as ADF;
- never round-trip the description through markdown;
- never substitute literal `- [x]` text for Jira action items.

Checklist completion is part of the verification evidence, not a cosmetic final step.

If the Jira tool cannot safely preserve ADF, do not modify the checklist; report that limitation in the In Review comment.


### Issue links

For Jira `Blocks` links:
- `inwardIssue` = the blocker
- `outwardIssue` = the blocked issue

Do not create/change links unless the Story requires it. Ask the human to visually verify direction after a link write.

## 11. In Review handoff

When implementation and verification are complete:

1. Complete the shared Git lifecycle in `.agents/workflows/story-git-lifecycle.md`:
   - stage only explicit Story files;
   - inspect the staged diff;
   - create the Story commit;
   - record branch name and commit hash;
   - confirm no relevant Story changes remain uncommitted.
2. Update only objectively verified Acceptance Criteria task items to `DONE`.
3. Set `Actual thinking effort` using the rule above.
4. Transition the Story to **In Review** using the actual transition available in Jira.
5. Post a PR-style review comment containing:
   - branch name;
   - commit hash;
   - Acceptance Criteria checklist state, including any criterion left `TODO` and why;
   - scope implemented;
   - files changed;
   - verification evidence;
   - one line per Acceptance Criterion;
   - Actual effort + criterion/evidence;
   - residual risks;
   - out-of-scope candidates;
   - for `high+`: alternative considered/rejected;
   - for `xhigh`: before/after coverage counts and skipped sites;
   - for `max`: hypothesis, falsification attempt, reproduction before/after, and what was ruled out.
6. STOP.

Do not begin another Story in the same session.
