# AI Prompt Refinement Workflow

## Purpose

Turn a tracked human prompt into an approved Jira Epic + User Story decomposition while preserving the original prompt and every material human clarification.

This workflow is for **analysis/refinement**, not implementation.

## Source artifact

A tracked refinement prompt is a Jira **Research/Spike** carrying the label:

`ai-prompt`

The issue description is the **original human prompt**.

Once refinement starts:

- treat that description as immutable;
- never rewrite it to incorporate clarifications;
- put later human clarifications/decisions in Jira comments;
- preserve the original input so prompt → refinement → delivery can be audited later.

If the supplied issue is not a Research/Spike labeled `ai-prompt`, do not pretend it is a tracked prompt. You may still perform an untracked analysis/proposal from the supplied requirement, but no source-artifact lifecycle or provenance writes apply unless the human explicitly asks to convert it into the tracked workflow.

## Human-owned refinement gate

Before refining a tracked prompt, read:

- `Agent` (`customfield_10115`)
- `Model` (`customfield_10116`)
- `Planned thinking effort` (`customfield_10117`)

These are human decisions. Never write or change them.

The active harness must match Jira `Agent`.

Model and effort are declared launch preconditions:
- a **known** mismatch is a STOP;
- static defaults are not proof of the active runtime when CLI/UI overrides may apply;
- inability to introspect a runtime override is not itself a mismatch;
- never change Jira to match the running session.

For a tracked prompt, the first output line must state:

`Agent: <agent> · Model: <model> · Planned effort: <effort> — <one-sentence refinement commitment>`

## Phase 1 — Read and analyze

Read:

1. the source Research/Spike;
2. `AGENTS.md`;
3. every applicable `.claude/rules/*.md` from the routing table;
4. relevant routed `docs/*.md`;
5. repository source only as needed to understand the real system.

Do not modify source code.

Determine:

1. what user/system outcome the prompt is actually trying to achieve;
2. what existing behavior and architecture constrain it;
3. **what would make the proposed decomposition wrong**;
4. which uncertainties must be resolved before implementation rather than silently turned into assumptions;
5. whether part of the requested work should itself remain a Research/Spike;
6. the smallest coherent independently reviewable delivery slices.

Prefer evidence from the actual repository over assumptions derived from filenames or prompt wording.

## Phase 2 — Clarify material ambiguity

If an ambiguity materially affects:

- product behavior;
- domain semantics;
- UX/visual behavior;
- architecture;
- data representation;
- API contract;
- Story boundaries or dependencies;

**STOP and ask the human before finalizing the decomposition.**

Do not ask merely because alternatives exist.

Do not ask questions the repository can answer safely through read-only investigation.

After the human answers:
- keep the original prompt description unchanged;
- record/retain the clarification as discussion/comment context;
- continue the same refinement run.

## Phase 3 — Proposal

Propose exactly one Epic unless the analysis demonstrates that the source prompt contains multiple genuinely independent initiatives.

For every proposed Story provide:

### `<provisional title>`

**User value / intent**  
Why the Story exists and what changes for the user/system.

**Scope**  
What the Story does.

**Out of scope**  
Adjacent work deliberately excluded.

**Acceptance Criteria**  
Concrete, externally observable or objectively verifiable criteria. They must be strong enough to act as the implementation oracle.

Avoid vague criteria such as:
- works correctly;
- is robust;
- follows best practices;
- handles errors appropriately.

State the actual expected behavior.

**Dependencies**  
Use `None` when there are none.

**Relevant existing areas**  
Verified files/modules/docs for orientation, not as an implementation prescription.

**Risks / unresolved questions**  
Only real uncertainties.

**Suggested Category**  
Use the project's existing Category semantics.

**Suggested Agent / Model / Planned thinking effort**  
Recommend them with a short reason, but never write these human-owned Story fields.

Do not serialize Stories merely for convenience. Keep only genuine dependencies.

## Phase 4 — Decomposition challenge

Before asking for approval, explicitly provide:

- number of Stories;
- why these boundaries were chosen;
- whether any Story can still be split without losing independent value;
- whether any Stories should be merged;
- minimal implementation order;
- strongest argument that the decomposition is wrong;
- any remaining human decision required before Ready to Develop.

Then say clearly that **nothing has been written to Jira yet** and ask for human approval.

STOP.

## Jira Acceptance Criteria format

Before creating any Story, read and follow:

`.agents/workflows/jira-acceptance-criteria.md`

Generated Story Acceptance Criteria must be real Jira ADF action items (`taskList` / `taskItem`), each initially `TODO`.

If the available Jira write tool cannot create/preserve that structure safely, STOP instead of falling back to markdown.

## Phase 5 — Jira creation after explicit approval

Jira creation is allowed only after an explicit human instruction equivalent to:

`Approved. Create exactly this Epic and these Stories.`

Create **exactly the approved decomposition**.

Do not silently:
- add a Story;
- remove a Story;
- merge/split Stories;
- rewrite scope;
- rewrite Acceptance Criteria;
- resolve a new ambiguity;
- change the recommended Story gate fields into actual values.

If Jira creation exposes a fact that would require changing the approved decomposition, STOP and ask.

### Generated Epic provenance

The generated Epic must include a clearly visible line:

`Source Prompt: HRA-xxx`

where `HRA-xxx` is the source Research/Spike key.

### Generated Story provenance

Every generated Story must:
- belong to the approved generated Epic;
- include a clearly visible `Source Prompt: HRA-xxx`;
- carry label `ai-refined`;
- represent Acceptance Criteria as a real ADF `taskList` with one `TODO` `taskItem` per criterion, following `.agents/workflows/jira-acceptance-criteria.md`.

Do **not** populate on generated Stories:
- `Agent`;
- `Model`;
- `Planned thinking effort`;
- `Actual thinking effort`;
- `Review Outcome`.

Those belong to the later human implementation gate/workflow.

## Phase 6 — Source handoff

After the approved Epic and Stories have been created successfully:

1. Post a comment on the source Research/Spike containing:
   - refinement Agent;
   - refinement Model;
   - Planned thinking effort;
   - generated Epic key;
   - generated Story keys;
   - material clarifications that changed the decomposition;
   - remaining caveats, if any.
2. Transition the source Research/Spike to **In Review**.
3. STOP.

Never move the source Research/Spike to Done. Human review closes the refinement.

## Untracked requirement mode

If the human gives requirement text directly instead of a tracked `ai-prompt` Jira issue:

- perform Phases 1–4;
- do not create/edit Jira unless the human explicitly asks after approving the proposal;
- do not invent a Source Prompt key;
- state that prompt provenance is untracked.

## Core invariant

The purpose of this workflow is not maximum automation.

It is to preserve this chain:

`original human intent → agent analysis → explicit human clarifications → approved decomposition → Jira delivery artifacts`

without silently rewriting history or delegating consequential product decisions to the agent.
