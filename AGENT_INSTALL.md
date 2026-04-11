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
4. If OpenCode already has an `opencode.json`, keep existing top-level settings and let the installer merge the `with-claude` provider entries.

## Expected result

After installation, the user's OpenCode config should include:

- the `with-claude` provider
- `@planClaude`
- `@implClaude`
- `@reviewClaude`

The installer also writes the bundled role config to:

- `~/.config/opencode/.opencode/opencode-with-claude.jsonc`

If `XDG_CONFIG_HOME` is set, use `$XDG_CONFIG_HOME/opencode` instead of `~/.config/opencode`.

## If the user asks what to read

Tell the agent to read this file first, then perform the install steps exactly as written.
