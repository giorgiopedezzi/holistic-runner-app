---
name: generate-user-stories
description: Decompose an HRA Epic, requirement, or feature into the smallest coherent human-reviewable Jira User Stories. Use for backlog refinement, Story design, decomposition, or Acceptance Criteria drafting. Read-only: never create/edit Jira issues and never implement code.
---

# Generate User Stories

This is refinement, not implementation.

## Hard boundaries

- Do not modify source code.
- Do not create or edit Jira issues.
- Do not populate Jira custom fields.
- Do not transition anything.
- Do not implement any proposed Story.
- Human review is mandatory before anything is written to Jira.

If given a Jira Epic/key, use Atlassian MCP to read it. If Jira is unavailable, work only from the requirement text explicitly provided and state that repository/Jira context could not be verified.

## Objective

Decompose the Epic or requirement into the **smallest coherent User Stories that can be implemented, verified, reviewed, and accepted independently**.

A Story is not a technical task list. Prefer vertical slices over backend/frontend/database layers when a vertical slice is independently useful and verifiable.

Do not create extra Stories merely to make the decomposition look systematic.

## Before proposing Stories

Inspect repository docs/source only as needed and determine:

1. What user or system outcome the Epic actually seeks.
2. What existing behavior and architecture constrain the solution.
3. **What would make the proposed decomposition wrong.**
4. Which uncertainties must be resolved before implementation rather than silently converted into assumptions.
5. Whether any part is actually a `Research/Spike`.

Use `AGENTS.md` routing and read applicable docs/rules for areas you inspect.

## Story boundary test

Each Story must:
- have one clear outcome;
- be independently reviewable;
- have Acceptance Criteria that can act as the implementation oracle;
- avoid prescribing implementation details unless they are part of the approved contract/constraint;
- contain only the smallest scope needed for that outcome;
- explicitly state tempting adjacent work that is out of scope;
- identify genuine dependencies.

Do not split purely by technical layer unless each layer is independently useful and verifiable.
Do not combine unrelated behavior merely because it touches the same files.

## Output for each proposed Story

### `<provisional title>`

**User value / intent**  
Why the Story exists and what changes for the user or system.

**Scope**  
What this Story does.

**Out of scope**  
Adjacent behavior deliberately excluded.

**Acceptance Criteria**  
Concrete, externally observable or objectively verifiable criteria. Avoid vague phrases such as “works correctly”, “is robust”, “follows best practices”, or “handles errors appropriately”; state the expected behavior.

**Dependencies**  
Other proposed Stories or existing capabilities required first. Use `None` when there are none.

**Relevant existing areas**  
Verified files/modules/docs that appear relevant. Orientation only, not an implementation prescription.

**Risks / unresolved questions**  
Only real uncertainties.

**Suggested Category**  
Recommend one project Jira Category with one sentence of rationale:
- `Business Functionality` — the end user sees/uses the outcome;
- `Technical Improvement` — product-code change with no end-user impact;
- `Enabler/Infrastructure` — machinery that makes future delivery possible/cheaper;
- `Research/Spike` — uncertainty is in the question/framing;
- `Bug` — correction of existing behavior.

**Suggested Agent / Model / Planned thinking effort**  
Recommend, but do not write, the human-owned fields.

Agent:
- `Claude Code`
- `Codex`

Model choices:
- Claude Code: `claude-sonnet-5`, `claude-opus-5`
- Codex/ChatGPT: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`

Effort ladder:
`low < medium < high < xhigh < max`

Give a short rationale based on the Story's actual uncertainty/blast radius, not on prestige or “more is better”.

For Codex, do not recommend `max` unless the current Codex client actually exposes that effort; otherwise recommend `xhigh` or recommend Claude for a genuinely `max` Story. Never pretend `xhigh = max`.

## After all Stories

### Decomposition check
- Number of Stories proposed.
- Why these boundaries were chosen.
- Whether any Story can still be split without losing independent value.
- Whether any two Stories should be merged.
- The strongest argument that the decomposition is wrong.
- Any human decision required before Ready to Develop.

### Suggested implementation order
Give the minimal dependency order. Do not serialize Stories that are genuinely independent.

Then STOP for human review.
