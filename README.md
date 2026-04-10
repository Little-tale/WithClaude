# opencode-with-claude

Claude CLI provider and workflow surfaces for OpenCode.

This package gives you two things:

- a `with-claude/*` provider that runs through the local **Claude CLI**
- bundled OpenCode subagents and command prompts for `@planClaude`, `@implClaude`, and `@reviewClaude`

## Quick start

### For humans

```bash
npx opencode-with-claude install
```

### For LLM agents

Tell the agent to run:

```bash
npx opencode-with-claude install
```

## What the installer does

The installer sets up the minimum files needed for this package inside the current project.

It will:

- create `.opencode/opencode-with-claude.jsonc`
- copy bundled Claude subagent prompts into `.opencode/agents/`
- copy bundled reusable command prompts into `.opencode/command/`
- create `opencode.jsonc` if the project does not already have one

If `opencode.jsonc` already exists, the installer does **not** overwrite it. Instead, it writes:

```text
opencode-with-claude.snippet.jsonc
```

so you can merge the provider/agent block manually.

## Prerequisites

- Node.js 22+
- OpenCode installed and available in your environment
- Claude CLI installed and available as `claude`

If Claude CLI is installed somewhere else, update the generated config accordingly.

## What you get

### Provider models

The package exposes these provider-backed models:

- `with-claude/haiku`
- `with-claude/sonnet`
- `with-claude/opus`

### Claude subagents

The package installs these OpenCode subagents:

- `@planClaude`
- `@implClaude`
- `@reviewClaude`

Use them from the OpenCode UI / TUI through mention-style invocation.

```text
@planClaude
@implClaude
@reviewClaude
```

These are **subagents**, not primary agents. That means:

- valid: mention-style subagent usage in OpenCode
- invalid: `opencode run --agent planClaude ...` as a direct primary replacement

## Saved files

Plan artifacts are saved automatically by the workflow tool path.

Current behavior:

- if `<workspaceRoot>/.sisyphus/plans` exists:
  - save to `.sisyphus/plans/plan-v<revision>.md`
- otherwise:
  - save to `plans/plan-v<revision>.md`

Other workflow artifacts still use `.omd/plan/<taskId>/...`.

## Config files

### `opencode.jsonc`

This is the project-level OpenCode config.

It connects:

- the `with-claude` provider
- the three Claude subagents

### `.opencode/opencode-with-claude.jsonc`

This is the user-editable Claude role config.

Use it to change:

- role model selection
- Claude CLI arguments
- timeouts and related runtime options

## Package surfaces

This package exposes two runtime surfaces:

- package root: provider factory (`createWithClaude`)
- `./plugin`: OpenCode workflow tools/state surface

## Development

```bash
npm install
npm run build
npm test
```

Useful scripts:

- `npm run dev`
- `npm run dev:mcp`
- `npm run build`
- `npm test`

## Package contents

The published tarball intentionally ships only runtime/package assets:

- `dist/`
- `.opencode/agents/`
- `.opencode/command/`
- `.opencode/opencode-with-claude.jsonc`
- `README.md`
- `.env.example`

Project-local development files such as `src/`, `Plan/`, `data-*`, and local config are not part of the intended install surface.

## Notes

- The package uses **Claude CLI**, not the Claude API.
- The provider runtime is the main long-term execution path.
- The bundled commands are designed to delegate into the Claude subagents instead of free-typing in the current primary agent.

## Uninstall

Remove the installed files from your project:

- `.opencode/opencode-with-claude.jsonc`
- `.opencode/agents/implClaude.md`
- `.opencode/agents/planClaude.md`
- `.opencode/agents/reviewClaude.md`
- `.opencode/command/implClaude.md`
- `.opencode/command/planClaude.md`
- `.opencode/command/reviewClaude.md`

If you created a project-level `opencode.jsonc` through the installer, remove or edit the `with-claude` provider and Claude subagent entries manually.
