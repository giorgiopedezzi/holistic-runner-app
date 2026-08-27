# Codex + Claude Code setup

This package makes `AGENTS.md` the shared global source of truth while keeping each harness thin.

## Final layout

```text
holistic-runner-app/
├── AGENTS.md
├── CLAUDE.md
├── .claude/
│   └── rules/
│       ├── backend.md
│       ├── frontend.md
│       ├── frontend-i18n.md
│       ├── fit-parser.md
│       └── api-contract.md
├── .agents/
│   └── skills/
│       ├── implement-story/
│       │   └── SKILL.md
│       └── generate-user-stories/
│           └── SKILL.md
├── .codex/
│   └── config.toml
├── docs/
│   └── ... existing project docs unchanged ...
└── ...
```

## 1. Copy the package into the repo root

Merge, do not delete your existing `docs/`.

`AGENTS.md` becomes the shared global source of truth.

`CLAUDE.md` becomes a tiny Claude adapter that imports `AGENTS.md`.

Keep the five `.claude/rules/*.md` files checked in. Claude loads them natively by path; Codex reads the same files through the routing in `AGENTS.md` / `$implement-story`.

## 2. Codex CLI

Use Codex CLI **0.144.0 or newer** for GPT-5.6.

Install/update:

```bash
npm install -g @openai/codex@latest
codex --version
```

From the repo root:

```bash
codex
```

Choose **Sign in with ChatGPT**. Do not configure an API key for this workflow.

Trust the repository when Codex asks; project-local `.codex/config.toml` is ignored for untrusted projects.

## 3. Atlassian Rovo MCP

The package already declares:

```toml
[mcp_servers.atlassian]
url = "https://mcp.atlassian.com/v1/mcp/authv2"
```

Authenticate:

```bash
codex mcp login atlassian
```

If the project-local config has not been copied yet, Atlassian's equivalent CLI setup is:

```bash
codex mcp add atlassian --url https://mcp.atlassian.com/v1/mcp/authv2
codex mcp login atlassian
```

Verify the MCP connection from Codex before Story work.

The config uses `default_tools_approval_mode = "writes"`: read-only MCP tools may proceed; tools not marked read-only require approval.

## 4. Verify shared instructions

### Claude Code

Start a fresh Claude session and run `/context`.

Confirm `CLAUDE.md` is loaded and that it imports `AGENTS.md`. Claude's `.claude/rules/` continue to work path-conditionally.

### Codex

Start from the **repo root**, then ask:

> Summarize the active project instructions and list the available repo skills. Do not modify anything.

You should see the two repo skills:
- `implement-story`
- `generate-user-stories`

Codex loads repo skills from `.agents/skills`.

## 5. Generate User Stories with Codex

For an Epic/key:

```text
$generate-user-stories HRA-123
```

or simply:

```text
Decompose HRA-123 into User Stories.
```

The skill is intentionally read-only: it may inspect Jira/repo context, but it must not create/edit Jira issues or implement code.

## 6. Implement a Story with Codex

At human Gate 1 in Jira set:
- `Agent = Codex`
- `Model = gpt-5.6-sol | gpt-5.6-terra | gpt-5.6-luna`
- `Planned thinking effort = low | medium | high | xhigh | max`

Then:

1. Start a **fresh Codex session for that Story**.
2. Select the exact Jira model and reasoning effort in Codex before work.
3. If Jira says `max` but your Codex client does not expose `max`, STOP; do not map it to `xhigh`.
4. Run:

```text
$implement-story HRA-123
```

or ask naturally:

```text
Implement HRA-123.
```

The skill gates Agent/Model/effort, loads applicable shared rules/docs, implements only the approved slice, verifies, writes Actual effort, transitions to In Review, comments, and stops.

## 7. Implement a Story with Claude Code

At Gate 1 set:
- `Agent = Claude Code`
- the Claude model
- Planned effort

Start a fresh Claude session and use your existing:

```text
/implement-story HRA-123
```

The global instructions now come from `AGENTS.md` through the thin `CLAUDE.md` import; Claude-specific path rules still load natively.

## 8. Session boundary

One Story = one clean session.

- Same harness/model/effort for the next Story: a clean/new session is still preferred.
- Different model or effort: relaunch/select before the new Story.
- Never chain Stories after In Review.

## 9. Deliberately not included

- No auto-router choosing Claude vs Codex.
- No judge-of-judge orchestration.
- No duplicated Codex copies of `.claude/rules/`.
- No `docs/agent-workflow.md`.
- No API key or secret in repo.
- No automatic Jira Story creation during refinement.

Human chooses Agent/Model/effort; the selected agent executes inside the gate.
