# Prompt-refinement overlay

Copy/merge this ZIP at the repository root.

It adds a shared tracked-prompt workflow without changing your existing implementation workflow.

## Files

- `AGENTS.md` — updated shared global instructions
- `.agents/workflows/refine-prompt.md` — single source of truth for prompt → Epic/Stories refinement
- `.agents/skills/generate-user-stories/SKILL.md` — thin Codex adapter
- `.claude/commands/generate-user-stories.md` — thin Claude Code adapter

## Jira convention

Use an existing `Research/Spike` issue with:

- label: `ai-prompt`
- description: the original prompt, kept immutable once refinement starts
- Agent / Model / Planned thinking effort: set by the human for the refinement run

Later clarifications go in comments.

Generated Stories receive `ai-refined` and `Source Prompt: HRA-xxx`, but their implementation Agent/Model/Planned fields remain unset until the later human Gate 1.

## Usage

Claude Code:

```text
/generate-user-stories HRA-123
```

Codex:

```text
$generate-user-stories HRA-123
```

Both execute the same `.agents/workflows/refine-prompt.md`.

If your existing Claude slash commands live somewhere other than `.claude/commands/`, move `generate-user-stories.md` beside your existing `implement-story` command; its content is intentionally adapter-only.
