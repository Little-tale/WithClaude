# opencode-with-claude

[English](./README.md) | [한국어](./README.ko.md)

Claude CLI provider and Gemini CLI and workflow surfaces for OpenCode.

This package gives you two things:

- provider-backed models that run through the local **Claude CLI** and **Gemini CLI**
- bundled OpenCode subagents and command prompts for `@planClaude`, `@implClaude`, `@designGemini`, `@reviewClaude`, and `@reviewGemini`

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

- create `~/.config/opencode/.opencode/opencode-with-claude.jsonc` as a user override file
- create `~/.config/opencode/package.json` with the package as a managed local-plugin dependency
- create `~/.config/opencode/plugins/with-claude-plugin.mjs` so the plugin hook surface loads on startup
- copy bundled reusable command prompts into `~/.config/opencode/.opencode/command/`
- create or merge `~/.config/opencode/opencode.json`

If `~/.config/opencode/opencode.json` already exists, the installer preserves existing top-level fields and merges the `with-claude` / `with-gemini` providers and workflow subagents into that global config.

The bundled Claude subagent prompts and default role config now load from the installed npm package at runtime, so new package releases can update those defaults without re-copying them into user config.

OpenCode also loads the package's plugin hook surface through the generated local plugin shim. On session startup, that hook:

- bootstraps older installs into the managed plugin workspace if needed
- syncs bundled prompts/commands from the installed package
- checks npm for a newer `latest` release when the managed dependency is not pinned
- runs the package-manager update in `~/.config/opencode` automatically when a newer release exists

If a newer package is installed during startup, OpenCode will notify the user. A restart may be needed for the just-installed runtime to take effect immediately in the current session.

## Prerequisites

- Node.js 22+
- OpenCode installed and available in your environment
- Claude CLI installed and available as `claude`
- Gemini CLI installed and available as `gemini` if you want Gemini-backed subagents

If Claude CLI is installed somewhere else, update the generated config accordingly.

> Warning: this package depends on the local Claude CLI. If Anthropic changes Claude CLI policy and a user is banned, suspended, rate-limited, or otherwise restricted as a result of CLI usage, this repository does not accept responsibility for that outcome.

## What you get

### Provider models

The package exposes these provider-backed models:

- `with-claude/haiku`
- `with-claude/sonnet`
- `with-claude/opus`
- `with-gemini/auto`
- `with-gemini/pro`
- `with-gemini/flash`
- `with-gemini/flash-lite`
- `with-gemini-yolo/auto`
- `with-gemini-yolo/pro`
- `with-gemini-yolo/flash`
- `with-gemini-yolo/flash-lite`

The Gemini models above are Gemini CLI aliases exposed directly through the local provider.
The `with-gemini-yolo/*` variants are the YOLO-approval Gemini route aliases for write-enabled Gemini execution paths.

### Workflow subagents

The package installs these OpenCode subagents:

- `@planClaude`
- `@implClaude`
- `@designGemini`
- `@reviewClaude`
- `@reviewGemini`

Use them from the OpenCode UI / TUI through mention-style invocation.

![Example OpenCode mention-style Claude subagents](docs/assets/claude-subagents-example.svg)

```text
@planClaude
@implClaude
@designGemini
@reviewClaude
@reviewGemini
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
- the `with-gemini` provider
- the `with-gemini-yolo` provider
- the bundled workflow subagents

### `XDG_CONFIG_HOME/opencode/.opencode/opencode-with-claude.jsonc` or `~/.config/opencode/.opencode/opencode-with-claude.jsonc`

This is the user-editable workflow role config.

Use it to change:

- the default Claude model for all workflow roles
- per-role model overrides when one role should differ
- Claude CLI arguments
- the default Gemini CLI alias for Gemini workflow roles
- Gemini CLI command / timeout / role overrides
- timeouts and related runtime options

The plugin loads bundled package defaults first, then applies this global file as an override. If a workspace also has `.opencode/opencode-with-claude.jsonc`, that project-local file overrides the global values for that workspace only. Partial workspace overrides keep the remaining bundled/global settings unless they explicitly replace them.

The simplest way to switch models is to change one value:

```jsonc
{
  "claudeCli": {
    "defaultModel": "opus",
  },
}
```

That applies the same Claude model to `@planClaude`, `@implClaude`, and `@reviewClaude`.

If one role should use a different model, keep the shared default and override only that role:

```jsonc
{
  "claudeCli": {
    "defaultModel": "sonnet",
    "roles": {
      "planClaude": {
        "model": "opus",
      },
    },
  },
}
```

In that example, planning uses `opus` while implementation and review still use `sonnet`.

Gemini-backed subagents use the separate `geminiCli` section.

The simplest Gemini setup is to choose the shared Gemini alias once:

```jsonc
{
  "geminiCli": {
    "auto": "flash",
  },
}
```

That updates the shared Gemini CLI alias used by the Gemini workflow roles.

By default, the bundled workflow agents do not resolve to the same provider route:

- `@designGemini` defaults to `with-gemini-yolo/auto`
- `@reviewGemini` defaults to `with-gemini/auto`

This split exists because `@designGemini` is write-enabled by default, while `@reviewGemini` stays on the read-only route by default.

If you need to control that behavior explicitly, use `geminiExecutionPolicy` on the agent config:

```jsonc
{
  "agent": {
    "designGemini": {
      "geminiExecutionPolicy": "write-enabled",
    },
    "reviewGemini": {
      "geminiExecutionPolicy": "read-only",
    },
  },
}
```

`geminiExecutionPolicy` accepts:

- `"write-enabled"` - route Gemini-backed execution through the YOLO approval alias (`with-gemini-yolo/*`)
- `"read-only"` - keep Gemini-backed execution on the standard non-YOLO alias (`with-gemini/*`)

If you want a more specific setup, keep the shared Gemini alias and override only the role that should differ.

```jsonc
{
  "geminiCli": {
    "auto": "auto",
    "roles": {
      "reviewGemini": {
        "model": "pro",
      },
    },
  },
}
```

This is an advanced override. The default path is to use one shared Gemini alias unless a role truly needs something different.

### Example: `oh-my-opencode.json`

If you are also using oh-my-openagent / oh-my-opencode-style agent overrides, point the target agents at the provider-backed models explicitly:

```jsonc
{
  "agents": {
    "sisyphus": {
      "model": "with-claude/opus",
    },
    "atlas": {
      "model": "with-claude/sonnet",
    },
  },
}
```

If you want Gemini-backed overrides, use the Gemini routes directly:

```jsonc
{
  "categories": {
    "visual-engineering": {
      "model": "with-gemini-yolo/pro",
    },
    "quick": {
      "model": "with-gemini/flash",
    },
  },
}
```

That works only after the relevant providers are already installed and present in your OpenCode provider config.

## Package surfaces

This package exposes two runtime surfaces:

- package root: provider factories (`createWithClaude`, `createWithGemini`)
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

- The package uses local **Claude CLI** and **Gemini CLI**, not hosted API SDKs.
- The provider runtime is the main execution path for provider-backed models.
- The bundled commands are designed to delegate into the workflow subagents instead of free-typing in the current primary agent.

## Uninstall

Remove the installed files from your global OpenCode config:

- `~/.config/opencode/.opencode/opencode-with-claude.jsonc`
- `~/.config/opencode/package.json` (or remove just the `@little_tale/opencode-with-claude` dependency)
- `~/.config/opencode/plugins/with-claude-plugin.mjs`
- `~/.config/opencode/.opencode/command/designGemini.md`
- `~/.config/opencode/.opencode/command/implClaude.md`
- `~/.config/opencode/.opencode/command/planClaude.md`
- `~/.config/opencode/.opencode/command/reviewClaude.md`
- `~/.config/opencode/.opencode/command/reviewGemini.md`

Then remove or edit the `with-claude` / `with-gemini` provider entries and workflow subagent entries in `~/.config/opencode/opencode.json` manually.
