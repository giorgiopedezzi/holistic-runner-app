# Jira Acceptance Criteria — ADF action-item invariant

Acceptance Criteria in this project are **real Jira ADF action items**, not markdown checkboxes.

The canonical Jira structure is:

- `taskList`
- containing one `taskItem` per Acceptance Criterion
- `taskItem.attrs.state` = `TODO` or `DONE`

## Story creation

When an agent creates a Story:

1. Acceptance Criteria must be emitted as a real ADF `taskList`.
2. Each Acceptance Criterion must be a separate `taskItem`.
3. Every newly created criterion starts as `TODO`.
4. Never create AC as:
   - literal `- [ ] ...`;
   - ordinary bullet-list text;
   - flattened markdown pretending to be a checklist.
5. Preserve all non-AC description sections as proper ADF nodes.

If the available Jira tool cannot safely create the required ADF structure, STOP and report the limitation. Do not silently degrade the checklist format.

## Story implementation

When an agent implements a Story:

1. Read/preserve the complete Jira description as ADF.
2. Map each existing Acceptance Criterion to its corresponding `taskItem`.
3. Mark a criterion `DONE` **only after** objective verification for that criterion passes.
4. Change only the relevant `taskItem.attrs.state` from `TODO` to `DONE`.
5. Any criterion not demonstrably satisfied remains `TODO`.
6. Never reconstruct the description through markdown.
7. Never replace real action items with literal `- [x] ...` text.
8. Never mark all criteria `DONE` merely because implementation finished or tests passed globally.

Preferred order:

`implement → verify AC individually → update verified taskItems → Actual effort → In Review`

If the Jira tool cannot safely preserve the existing ADF structure, leave the checklist unchanged and explicitly report that limitation in the In Review comment.

## Why this is strict

Markdown round-tripping can silently destroy Jira `taskList` / `taskItem` structure while still looking superficially correct in API text output. Treat ADF preservation as data integrity, not formatting.
