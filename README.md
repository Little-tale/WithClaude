# opencode-with-claude

OpenCode **provider-layer** Claude CLI integration with workflow state adapters (HTTP + MCP) and an optional plugin subpath for local OpenCode workflow tools.

## Install

For a new project:

```bash
npx opencode-with-claude install
```

This installer:

- creates `.opencode/opencode-with-claude.jsonc`
- copies bundled Claude subagent and command prompt files into `.opencode/`
- creates a baseline `opencode.jsonc` if one does not already exist

If `opencode.jsonc` already exists, the installer preserves it and writes `opencode-with-claude.snippet.jsonc` for manual merge.

## Package contents

The published package is intended to ship only the runtime/provider surfaces and bundled OpenCode prompt assets:

- `dist/`
- `.opencode/agents/`
- `.opencode/command/`
- `.opencode/opencode-with-claude.jsonc`
- `README.md`
- `.env.example`

Project-local files like `opencode.jsonc`, `Plan/`, `data-*`, `src/`, and tests are development assets and are not intended to be part of the npm tarball.

## What exists now

- Claude CLI-backed provider package at the package root (`src/provider/*`)
- Optional plugin subpath (`./plugin`) for workflow tools/state access
- Express HTTP API for task lifecycle control
- Persistent JSON-backed shared task store
- MCP stdio server for workflow-state tools
- OpenCode-native subagents under `.opencode/agents/`
- OpenCode-native reusable commands under `.opencode/command/`

## Scripts

- `npm run dev` — start HTTP app in watch mode
- `npm run dev:mcp` — start MCP stdio server in watch mode
- `npm run build` — compile TypeScript

## OpenCode-native command surface

Reusable custom prompts now live under:

- `.opencode/command/implClaude.md`
- `.opencode/command/planClaude.md`
- `.opencode/command/reviewClaude.md`

Subagents intended for the `@` picker now live under:

- `.opencode/agents/implClaude.md`
- `.opencode/agents/planClaude.md`
- `.opencode/agents/reviewClaude.md`

Project-level OpenCode config now declares:

- the `with-claude` provider at the package root
- agent discovery for `@implClaude`, `@planClaude`, `@reviewClaude`

The package is now split into two surfaces:

- **provider root**: Claude CLI-backed model execution (`with-claude/haiku`, `with-claude/sonnet`, `with-claude/opus`)
- **plugin subpath**: workflow tools/state surface

Actual Claude role customization now lives in `.opencode/opencode-with-claude.jsonc`, where the provider-backed roles use our own Claude CLI runner configuration. Choose Haiku / Sonnet / Opus there as Claude CLI model aliases.

In the current transition state, OpenCode-facing agents still exist as wrappers over workflow tools, but the target direction is provider-first execution.

The standalone CLI surface has been removed; the intended interactive surface is now OpenCode + plugin/commands.

## Notes

- The HTTP server and MCP server are separate entrypoints that share the same task-store/orchestrator code.
- This keeps one codebase and one shared state model while respecting MCP stdio runtime constraints.
- The HTTP adapter now mirrors the plugin semantics: `POST /tasks` creates a draft only, and approval is explicit rather than auto-triggering implementation/review.

### Claude CLI role configuration

The actual Claude role configuration now lives in:

- `.opencode/opencode-with-claude.jsonc`

This file controls the internal Claude CLI runner for provider-backed role execution:

- `run_claude_plan`
- `run_claude_implementation`
- `run_claude_review`

It is where users choose:

- Claude Haiku / Sonnet / Opus aliases
- role-specific CLI args
- timeout settings

The provider-backed models are intended to be the long-term path for `@planClaude`, `@implClaude`, and `@reviewClaude` style usage.

New tasks now start in `draft_plan` and only move to `awaiting_approval` after a plan is successfully saved.
