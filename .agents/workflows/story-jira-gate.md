# Jira Gate for Story implementation

This workflow applies to every implementation Story executed by Claude Code or Codex.

## Core rule

A **new Story implementation may start only from Jira status `Ready to Develop`**.

`Ready to Develop` is the human Gate 1. Its presence means the Story scope and Acceptance Criteria have been reviewed and the human has deliberately released the Story for implementation.

The agent must never promote a Story into `Ready to Develop` itself.

## Start matrix

| Current Jira status | Agent action |
|---|---|
| `BACKLOG` / `Backlog` | **STOP.** Not approved for implementation. |
| `REFINEMENT` / `Refinement` | **STOP.** Not approved for implementation. |
| `Ready to Develop` | May start, after all Agent / Model / Planned-effort gates also pass. |
| `In Progress` | May continue **only** when the human explicitly asked to continue/resume this same Story and the Story branch already exists. Never treat this as permission to start a new implementation. |
| `In Review` | **STOP.** Human Gate 2 owns the next decision. |
| `Done` | **STOP.** No implementation work. |
| Any other status | **STOP** unless repository governance explicitly defines it as an implementation-entry state. |

## Required order for a new Story

1. Read Jira issue and current status.
2. Require status exactly `Ready to Develop`.
3. Require human-owned `Agent`, `Model`, and `Planned thinking effort`.
4. Verify the launched harness/model/effort according to `AGENTS.md`.
5. Establish the dedicated Story branch.
6. Transition Jira to `In Progress`.
7. Only then edit source code.

The transition from `Ready to Develop` to `In Progress` is an execution action authorized by the already-passed human Gate 1. It is not a substitute for Gate 1.

## Resume rule

An `In Progress` Story may be resumed only when all of these are true:

- the human explicitly asked to continue/resume that Story;
- the Jira key matches the Story being resumed;
- the dedicated Story branch already exists;
- current branch/working-tree evidence is consistent with that Story;
- Agent / Model / Planned-effort gates still match the launched session.

If any condition is not met, STOP.

Do not create a new branch from an `In Progress` issue as a way to bypass `Ready to Develop`.

## Never do this

- implement a Story directly from Backlog;
- implement a Story directly from Refinement;
- move a Story to `Ready to Develop`;
- infer that filled Agent/Model/effort fields imply Ready-to-Develop approval;
- use a human request like "implement HRA-123" to override Jira status silently;
- continue working after Jira reaches In Review or Done.

## Core invariant

`Ready to Develop` is not metadata. It is the human authorization boundary for starting implementation.
