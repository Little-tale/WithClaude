# Agent Install Instructions

This file is for LLM agents working from either a cloned copy of this repository or the installed package contents.

## Goal

Install `@little_tale/opencode-with-claude` into the user's OpenCode environment.

## Steps

1. Verify the user has Node.js 22 or newer.
2. Run the installer from this package:

```bash
npx @little_tale/opencode-with-claude install
```

3. Confirm Claude CLI is installed and available as `claude`.
4. Confirm Gemini CLI is installed and available as `gemini` if the user wants `@designGemini` or `@reviewGemini`.
5. If OpenCode already has an `opencode.json`, keep existing top-level settings and let the installer merge the workflow provider entries.

## Expected result

After installation, the user's OpenCode config should include:

- the `with-claude` provider
- the `with-gemini` provider
- the Gemini CLI alias-backed models `with-gemini/auto`, `with-gemini/pro`, `with-gemini/flash`, and `with-gemini/flash-lite`
- `@planClaude`
- `@implClaude`
- `@designGemini`
- `@reviewClaude`
- `@reviewGemini`

The installer also bootstraps a managed local plugin workspace under the user's OpenCode config so startup hooks can keep bundled prompts and the npm package up to date automatically.

The installer writes the user override file to:

- `~/.config/opencode/.opencode/opencode-with-claude.jsonc`

That file is now an override file for user customizations. Bundled default role config and subagent prompts load from the installed npm package at runtime so package updates can refresh them automatically.

The install also creates:

- `~/.config/opencode/package.json`
- `~/.config/opencode/plugins/with-claude-plugin.mjs`

Those files let OpenCode load the plugin hook surface at startup and auto-update the package when a newer `latest` release is available.

If `XDG_CONFIG_HOME` is set, use `$XDG_CONFIG_HOME/opencode` instead of `~/.config/opencode`.

## If the user asks what to read

Tell the agent to read this file first, then perform the install steps exactly as written.
