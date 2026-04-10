# Provider-Layer Claude CLI Migration Plan (Current)

## TL;DR
- **Primary surface**: OpenCode provider layer (`with-claude/*`) + OpenCode agents
- **Execution backend**: our own internal `claude -p` subprocess runner only
- **No Claude API** and **no external Claude provider plugin** assumptions
- **No in-repo Discord runtime**; if Discord is ever needed later, use an external bridge such as Kimaki
- **Current adapters**: HTTP and MCP only

## Current architecture

### Core runtime
- `src/provider/index.ts` — provider package root entry
- `src/provider/with-claude-language-model.ts` — LanguageModelV2 implementation
- `src/provider/session-manager.ts` — Claude CLI process/session layer
- `src/provider/message-builder.ts` — AI SDK prompt -> Claude CLI stream-json input
- `src/provider/tool-mapping.ts` — tool mapping for provider streaming
- `src/opencode/plugin.ts` — plugin subpath for workflow-state tools
- `src/agents/claude-cli.ts` — internal Claude CLI subprocess runner
- `src/orchestrator/host.ts` / `src/orchestrator/host-factory.ts` — shared orchestration composition root
- `src/orchestrator/orchestrator.ts` — task lifecycle state machine
- `src/orchestrator/pipeline.ts` — planner / implementation / review workflow logic
- `src/store/json-task-store.ts` — JSON persistence
- `src/artifacts/markdown-artifacts.ts` — `.omd/plan/*` artifact writing

### OpenCode-facing surfaces
- `opencode.jsonc` — thin discovery shim for `@` autocomplete
- `.opencode/opencode-with-claude.jsonc` — user-customizable Claude CLI config
- `.opencode/agents/*.md` — subagent prompts for `@implClaude`, `@planClaude`, `@reviewClaude`
- `.opencode/command/*.md` — reusable OpenCode command prompts

### Remaining adapters
- `src/main.ts` + `src/http/create-app.ts` — HTTP adapter
- `src/mcp-main.ts` + `src/mcp/server.ts` — MCP adapter

## Hard rules

1. **Claude API is forbidden**
2. **Claude work must happen through Claude CLI only**
3. Provider layer is the intended path for `@planClaude`, `@implClaude`, and `@reviewClaude`
4. `opencode.jsonc` should declare the `with-claude` provider and agent discovery
5. No new in-repo Discord logic

## What is already done

### Foundation
- shared host extracted
- plugin entry added
- standalone CLI/TUI removed
- in-repo Discord subsystem removed
- persistence / artifact / planner / implementer contracts covered by tests

### Claude CLI / provider pivot
- internal `src/agents/claude-cli.ts` added
- provider-layer scaffolding added under `src/provider/*`
- plugin tool surface now includes:
  - `run_claude_plan`
  - `run_claude_implementation`
  - `run_claude_review`
- `create_task` now creates **draft only**
- `save_plan_revision` now **directly saves authored plan text**
- `.opencode/opencode-with-claude.jsonc` now controls Claude CLI command / args / model aliases per role

### Test status
- `npm run build` passes
- `npm test` passes
- current suite count: **27 tests**

## Phase status

The old wrapper/tool cleanup phase is complete. The active phase now is the provider-layer migration.

Completed outcomes:
- OpenCode/plugin-first core
- no in-repo Discord runtime
- no standalone CLI/TUI
- no public planner bridge/runtime path
- no public legacy host auto-pipeline path
- actual plan / implement / review generation routed through the internal Claude CLI runner
- draft-only task creation
- direct-save authored plan revisions that become approval-ready
- approval-only plugin/HTTP semantics
- docs aligned with the current runtime story

## Current next steps

1. Complete the provider-layer implementation so `@...Claude` no longer requires a wrapper model hop
2. Expand MCP/tool parity for provider-backed agents if needed
3. Add dedicated tests for the provider layer itself

## Verification gate

This phase has already passed its completion gate with:
- `npm run build`
- `npm test`
- verify `opencode agent list` shows `implClaude`, `planClaude`, `reviewClaude`
- verify `@reviewClaude` (and peers) appear in a fresh OpenCode session in this repo
