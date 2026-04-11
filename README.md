# opencode-with-claude

Claude CLI provider and workflow surfaces for OpenCode.

This package gives you two things:

- a `with-claude/*` provider that runs through the local **Claude CLI**
- bundled OpenCode subagents and command prompts for `@planClaude`, `@implClaude`, and `@reviewClaude`

## Quick start

### For humans

```bash
npx @little_tale/opencode-with-claude install
```

## Automatic npm publishing

This repo includes a GitHub Actions workflow that publishes the package automatically after the `CI` workflow succeeds on `main`.

Important release behavior:

- the workflow only publishes when the `package.json` version is not already on npm
- if the version already exists, the workflow exits cleanly and skips publishing
- publishing uses npm trusted publishing (`id-token: write`) instead of a long-lived npm token

One-time npm setup is still required on the npm website:

1. publish `@little_tale/opencode-with-claude` once manually, or create the package/trusted publisher entry on npm
2. add this GitHub repository as a trusted publisher for the package
3. keep the package `repository.url` pointed at `https://github.com/Little-tale/WithClaude`

After that, releasing a new version is just:

1. bump `package.json` version in a PR
2. merge the PR to `main`
3. let GitHub Actions publish the new version automatically

### For LLM agents

Tell the agent to read `./AGENT_INSTALL.md` in this repository and follow it.

The local markdown file is the source of truth for agent-driven installation, so the setup flow does not depend on an external install link.

The install step inside that file is:

```bash
npx @little_tale/opencode-with-claude install
```

## What the installer does

The installer sets up the minimum files needed for this package inside your global OpenCode config.

By default it uses `XDG_CONFIG_HOME/opencode` when `XDG_CONFIG_HOME` is set; otherwise it falls back to `~/.config/opencode`.

It will:

- create `~/.config/opencode/.opencode/opencode-with-claude.jsonc`
- copy bundled Claude subagent prompts into `~/.config/opencode/.opencode/agents/`
- copy bundled reusable command prompts into `~/.config/opencode/.opencode/command/`
- create or merge `~/.config/opencode/opencode.json`

If `~/.config/opencode/opencode.json` already exists, the installer preserves existing top-level fields and merges the `with-claude` provider and Claude subagents into that global config.

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

### `XDG_CONFIG_HOME/opencode/opencode.json` or `~/.config/opencode/opencode.json`

This is the global OpenCode config.

It connects:

- the `with-claude` provider
- the three Claude subagents

### `XDG_CONFIG_HOME/opencode/.opencode/opencode-with-claude.jsonc` or `~/.config/opencode/.opencode/opencode-with-claude.jsonc`

This is the user-editable Claude role config.

Use it to change:

- role model selection
- Claude CLI arguments
- timeouts and related runtime options

The plugin reads this global config by default. If a workspace also has `.opencode/opencode-with-claude.jsonc`, that project-local file overrides the global values for that workspace only. Partial workspace overrides keep the remaining global role settings unless they explicitly replace them.

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

## Repository docs

- `README.md` - human-oriented overview and package behavior
- `AGENT_INSTALL.md` - agent-readable install instructions
- `CONTRIBUTION.md` - contribution workflow for changes and PRs
- `LICENSE` - project license terms

## Package contents

The published tarball intentionally ships only runtime/package assets:

- `dist/`
- `.opencode/agents/`
- `.opencode/command/`
- `.opencode/opencode-with-claude.jsonc`
- `AGENT_INSTALL.md`
- `README.md`
- `LICENSE`
- `.env.example`

Project-local development files such as `src/`, `Plan/`, `data-*`, and local project config are not part of the intended install surface.

## Notes

- The package uses **Claude CLI**, not the Claude API.
- The provider runtime is the main long-term execution path.
- The bundled commands are designed to delegate into the Claude subagents instead of free-typing in the current primary agent.

## Uninstall

Remove the installed files from your global OpenCode config:

- `~/.config/opencode/.opencode/opencode-with-claude.jsonc`
- `~/.config/opencode/.opencode/agents/implClaude.md`
- `~/.config/opencode/.opencode/agents/planClaude.md`
- `~/.config/opencode/.opencode/agents/reviewClaude.md`
- `~/.config/opencode/.opencode/command/implClaude.md`
- `~/.config/opencode/.opencode/command/planClaude.md`
- `~/.config/opencode/.opencode/command/reviewClaude.md`

Then remove or edit the `with-claude` provider and Claude subagent entries in `~/.config/opencode/opencode.json` manually.
