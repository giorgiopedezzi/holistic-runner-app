# Jira options for dual-agent operation

## Agent (`customfield_10115`)

Recommended exact values:
- `Claude Code`
- `Codex`

The human sets this field at Gate 1. Agents read it; agents never write it.

## Model (`customfield_10116`)

Recommended exact values:
- `claude-sonnet-5`
- `claude-opus-5`
- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`

Keep `Agent` and `Model` separate so later analysis can compare harness vs model.

## Planned / Actual thinking effort

Keep the existing shared ordered ladder:
- `low`
- `medium`
- `high`
- `xhigh`
- `max`

Do not add OpenAI-specific `none`/`minimal`; preserving one common axis makes Planned-vs-Actual and cross-agent analysis meaningful.

### Codex `max` caveat

Current Codex local configuration documentation exposes up to `xhigh`, while the GPT-5.6 API model family itself supports `max`.

Therefore:
- keep `max` in Jira because Claude and the underlying model taxonomy use it;
- do **not** silently translate a Codex Story from `max` to `xhigh`;
- if the running Codex client cannot explicitly select `max`, STOP and let the human reassign Agent/effort.

## Existing human-owned fields

These remain human-owned:
- `Contributor Type` (`customfield_10114`)
- `Agent` (`customfield_10115`)
- `Model` (`customfield_10116`)
- `Planned thinking effort` (`customfield_10117`)
- `Review Outcome` (`customfield_10118`)

The only decision-adjacent measurement the agent writes is:
- `Actual thinking effort` (`customfield_10152`)
