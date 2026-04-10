# Agent Workflow MVP — Handoff

Updated: 2026-04-10 (loop issue fixed via v3-style finish emission; second `doStream` empty-output bug also fixed; plugin now reads global installer config with project-local override; installer now matches XDG-first config resolution and nested overrides merge correctly)

## Status at a glance

- ✅ `npm run build` passes
- ✅ `npm test` passes — **42 tests**
- ✅ Direct provider calls (`doGenerate` / `doStream`) work end-to-end with real Claude CLI
- ✅ **Loop issue fixed** — provider now emits v3-style `finish` (`{unified, raw}` + nested usage). DB shows `finish="stop"` and tokens populated; no more step storms.
- ✅ **Second-call empty-output bug fixed** (2026-04-10) — `doStream` now matches `doGenerate`'s session-id cleanup so subsequent invocations from a long-lived OpenCode server (TUI) don't reuse a stale `--session-id` and exit instantly.
- ✅ **Tool-calls loop fix** (2026-04-10) — `finish` reason now always `"stop"` since Claude CLI executes all tools internally. Previously `"tool-calls"` was emitted when tool_use blocks appeared in CLI output, causing OpenCode to re-enter its step loop indefinitely (manifested as `@planClaude` repeating the same answer).
- ✅ No `ProviderInitError`, no `MaxListenersExceededWarning`
- ✅ `opencode agent list` shows `implClaude`, `planClaude`, `reviewClaude`
- ✅ Direct provider runtime tests pass outside OpenCode

**The provider-init + base streaming blockers are resolved, BUT the "remaining issue" is back in our court.** 2026-04-09 concluded this was an upstream OpenCode primary-loop behavior. The 2026-04-10 re-diagnosis showed that was wrong — see `Plan/LOOP_DIAGNOSIS_2026-04-10.md` for the full investigation.

## Repo focus

- **OpenCode provider-layer Claude CLI architecture**
- **Claude CLI-only execution** (`claude -p` / `claude --output-format stream-json`)
- **HTTP + MCP adapters only**
- **No standalone CLI/TUI**
- **No in-repo Discord runtime**

## Architecture rules

1. **Do not use Claude API.**
2. **Only use Claude CLI** (`claude -p` or stream-json mode) for actual plan / implement / review generation.
3. Provider layer (`src/provider/*`) is the target execution path.
4. `opencode.jsonc` defines provider + agent discovery.
5. `.opencode/opencode-with-claude.jsonc` is the user-editable place for Haiku / Sonnet / Opus and CLI args.
6. Do not reintroduce Discord runtime code.

## Key runtime files

### Provider (the one OpenCode loads)
- `src/index.ts` — package root re-export (must keep `createWithClaude` as named export; OpenCode picks first `create*` key)
- `src/provider/index.ts` — provider factory
- `src/provider/with-claude-language-model.ts` — `doGenerate` + `doStream` implementation
- `src/provider/session-manager.ts` — process reuse per `(cwd, model)` key
- `src/provider/message-builder.ts`
- `src/provider/tool-mapping.ts`
- `src/provider/types.ts`

### Orchestrator / host (plugin-side workflow)
- `src/opencode/plugin.ts` (plugin subpath / workflow tools)
- `src/agents/claude-cli.ts`
- `src/orchestrator/host.ts`
- `src/orchestrator/host-factory.ts`
- `src/orchestrator/orchestrator.ts`
- `src/orchestrator/pipeline.ts`
- `src/store/json-task-store.ts`
- `src/artifacts/markdown-artifacts.ts`

### Adapters
- `src/main.ts`
- `src/http/create-app.ts`
- `src/mcp-main.ts`
- `src/mcp/server.ts`
- `src/opencode-bridge-main.ts`

### Config surfaces
- `opencode.jsonc` — provider `npm` spec + agent discovery
- `.opencode/opencode-with-claude.jsonc` — per-role model + CLI args
- `.opencode/agents/*.md` — subagent prompts (implClaude, planClaude, reviewClaude)
- `.opencode/command/*.md` — reusable command prompts

### Tests
- `src/tests/provider-entry.test.ts`
- `src/tests/provider-runtime.test.ts`
- `src/tests/provider-config-contract.test.ts`
- (+ 24 orchestrator / HTTP / plugin contract tests)

## Recently completed

### Prior phase (CLI-only cleanup)
- removed standalone CLI/TUI
- removed in-repo Discord subsystem
- extracted shared host/factory
- added provider-layer package root scaffolding
- moved plugin entry toward a subpath role
- added OpenCode subagent + command surfaces (`.opencode/agents/*.md`, `.opencode/command/*.md`)
- added internal `claude -p` runner (`src/agents/claude-cli.ts`)
- added workflow tools: `run_claude_plan`, `run_claude_implementation`, `run_claude_review`
- changed `create_task` to create **draft** tasks only
- changed `save_plan_revision` to **direct-save** authored plan text
- HTTP adapter aligned: `POST /tasks` drafts only; `POST /tasks/:id/approve` approves only (no auto-run)
- split config into `opencode.jsonc` + `.opencode/opencode-with-claude.jsonc`

### Provider-layer scaffolding
- package root exports a provider factory (`src/index.ts` → `src/provider/index.ts`)
- provider runtime files: `with-claude-language-model.ts`, `session-manager.ts`, `message-builder.ts`, `tool-mapping.ts`
- provider tests: `provider-entry.test.ts`, `provider-runtime.test.ts`, `provider-config-contract.test.ts`
- `opencode.jsonc` declares `with-claude/haiku`, `with-claude/sonnet`, `with-claude/opus`

## Session 2026-04-10 (afternoon) — `doStream` second-call empty output

## Session 2026-04-10 (evening) — plugin config fallback matches installer flow

**Symptom:** the installer now writes user-editable Claude role config to the global OpenCode path (`~/.config/opencode/.opencode/opencode-with-claude.jsonc`), but the plugin runtime only read `<projectRoot>/.opencode/opencode-with-claude.jsonc`. That meant `run_claude_plan` / `run_claude_implementation` / `run_claude_review` could ignore the installed global config entirely unless every workspace duplicated the same file locally.

**Fix** (`src/opencode/plugin.ts`):
- added a global config lookup rooted at `XDG_CONFIG_HOME/opencode` or `~/.config/opencode`
- load global `opencode-with-claude.jsonc` first
- load project-local `.opencode/opencode-with-claude.jsonc` second
- deep-merge the two so workspace-local values override the installed global defaults

**Verification:**
- `npm run build` ✅
- `npm test` ✅ — **42 tests**
- added regression coverage in `src/tests/opencode-plugin-entry.test.ts` proving:
  - plugin tools work with only the global installed config present
  - project-local `.opencode/opencode-with-claude.jsonc` overrides the global config for that workspace

## Session 2026-04-10 (late evening) — Oracle follow-up fixes

Oracle review identified two concrete issues in the new global-config flow.

**Fix 1 — installer now matches XDG-first resolution**

- `src/install.ts`
  - `defaultConfigDir()` now uses `XDG_CONFIG_HOME/opencode` when `XDG_CONFIG_HOME` is set
  - otherwise still falls back to `~/.config/opencode`
- `src/tests/install.test.ts`
  - added coverage for `parseArgs(["install"])` honoring `XDG_CONFIG_HOME`

Reason:
- before this fix, the installer defaulted to `~/.config/opencode` while the plugin read `XDG_CONFIG_HOME/opencode` first
- on XDG-configured systems that mismatch could make a default install write config somewhere the plugin would not read first

**Fix 2 — nested overrides now preserve global role/agent fields**

- `src/opencode/plugin.ts`
  - `mergeWithClaudeConfig()` now deep-merges each `agent.<name>` object
  - `mergeWithClaudeConfig()` now deep-merges each `claudeCli.roles.<name>` object
- `src/tests/opencode-plugin-entry.test.ts`
  - added regression coverage proving a project-local override that changes only `planClaude.model` still preserves global `args`, `prompt`, and `tools`

Reason:
- the earlier merge only overlaid top-level `agent` and `claudeCli.roles` maps
- a partial workspace override could silently drop global siblings like permission args or prompts

**Symptom (TUI):** `@planClaude` 첫 호출 정상, 두 번째 호출은 `0 toolcalls · 726ms` 로 빈 응답.

**Root cause:** `doStream` (`src/provider/with-claude-language-model.ts`) 가 첫 호출에서 `setClaudeSessionId(key, msg.session_id)` 로 Claude CLI 세션 ID 를 저장. 두 번째 호출에서 `deleteActiveProcess(key)` 만 했고 `deleteClaudeSessionId(key)` 는 빠뜨려서, `buildCliArgs` 가 `--session-id <stale-uuid>` 를 추가. Claude CLI 는 이미 존재하는 UUID 거부 → 즉시 exit → `closeHandler` → 빈 finish. `doGenerate` 는 이 정책을 이미 적용 중이었음 — `doStream` 만 빠진 비대칭이었음.

OpenCode TUI 처럼 서버 프로세스가 상주하는 환경에서만 재현됨 (`opencode run` 단발 실행은 매번 새 프로세스라 상태가 안 남아서 못 잡았음).

**Fix** (`src/provider/with-claude-language-model.ts:215-222`):
```ts
const key = sessionKey(cwd, this.modelId);
deleteClaudeSessionId(key);          // ← 추가
deleteActiveProcess(key);
...
const cliArgs = buildCliArgs({
  sessionKey: key,
  skipPermissions: this.config.skipPermissions !== false,
  includeSessionId: false,           // ← 추가
  model: this.modelId
});
```

**Verification:**
- `npm run build && npm test` → 36 tests pass
- 같은 Node 프로세스 내에서 `doStream` 3회 연속 호출 (`/tmp/verify-doublestream.mjs`) → call-1 4702ms ALPHA / call-2 4384ms BRAVO / call-3 4796ms CHARLIE — 모두 `finish={unified:"stop",raw:"stop"}`. 700ms 조기 종료 사라짐.

## Resolved — primary loop on with-claude/* (2026-04-10 morning)

See **`Plan/LOOP_DIAGNOSIS_2026-04-10.md`** for the full re-diagnosis.

Summary:
- Other primary agents (Sisyphus, Hephaestus on nemotron provider) exit cleanly at `step=1` with `finish="stop"` and tokens populated in DB.
- `with-claude/sonnet` never sets `finish` in DB (`finish=NULL`, `tokens=0`) → OpenCode's loop exit condition `lastAssistant2?.finish && ...` never passes → infinite step advancement (34k+ log lines for a single "OK" reply).
- Root cause hypothesis: our provider declares `specificationVersion = "v2"`, so OpenCode's internal V2→V3 adapter wraps our `finishReason: "stop"` into `{unified:"stop", raw:undefined}`. That object then flows into `ctx.assistantMessage.finish = value9.finishReason`, and the message schema rejects / drops the non-string value.
- The 2026-04-09 session concluded this was "upstream OpenCode primary-loop behavior outside this repo". **That conclusion was wrong** — same OpenCode binary, same primary agent loop, only the provider changed.

Next-step options (A logging → C unixfox diff → B v3 spec) are laid out in the diagnosis doc.

## Session 2026-04-09 — provider-init + streaming unblock (historical)

Four bugs found + fixed. Binary at `~/.local/share/mise/installs/node/22.22.0/lib/node_modules/opencode-ai/bin/.opencode` was decoded via `strings` to recover OpenCode's internal contracts. All four fixes still apply; only the concluding "upstream OpenCode bug" interpretation was superseded by LOOP_DIAGNOSIS_2026-04-10.md.

### Bug 1 — `file://.` → `ProviderInitError` (config)

OpenCode's `resolveSDK` passes `file://` specs verbatim to Node's dynamic `import()`:

```js
} else {
  log.info("loading local provider", { pkg: model.api.npm });
  installedPath = model.api.npm;   // raw, no path resolution
}
const mod = await import(installedPath);
const fn = mod[Object.keys(mod).find((k) => k.startsWith("create"))];
const loaded = fn({ name: model.providerID, ...options });
```

`"file://."` is not a valid Node ESM import URL, so Node rejected it and `resolveSDK` wrapped the error as `ProviderInitError`.

**Fix:**
- `opencode.jsonc` — `"npm"` is now the absolute file URL of the built entry:
  `"file:///Users/jaehyungkim/Desktop/agent-workflow-mvp/dist/index.js"`
- `src/tests/provider-config-contract.test.ts` — assertion now matches `^file:\/\/\/.+\/dist\/index\.js$` instead of the literal `file://.`.

**Caveat:** this path is **machine-specific**. Any clone must update the `npm` value, or we need a build step that writes a local path.

### Bug 2 — empty stream (missing `assistant` text handler)

After Bug 1, `opencode run` loaded the provider and spawned `claude`, but every turn produced zero text. Root cause: without `--include-partial-messages`, Claude CLI `stream-json` delivers the final response as a single `assistant` message:

```json
{"type":"assistant","message":{"content":[{"type":"text","text":"Hi!"}]}}
```

Our handler only matched `block.type === "tool_use"` inside `assistant` and silently dropped `text` and `thinking`. OpenCode received a stream with zero text deltas and treated every turn as an empty response.

**Fix in `src/provider/with-claude-language-model.ts` `doStream`:**
- Added `text` block handler: `ensureTextStarted()` + `text-delta` enqueue.
- Added `thinking` block handler: `reasoning-start` → `reasoning-delta` → `reasoning-end`.
- Extracted `ensureTextStarted()` and `closeStream()` helpers so both `result` and `close` paths funnel through one shared closer.

### Bug 3 — `proc.on("error")` listener leak

Session-manager reuses the Claude CLI subprocess across turns per `(cwd, model)` key. Each `doStream` call added a fresh `proc.on("error", ...)` without removing it, so after ~11 turns Node emitted `MaxListenersExceededWarning`.

**Fix:** scoped `errorHandler` as a local `const`, removed in `closeStream` alongside the `lineEmitter` handlers.

### Bug 4 — `undefined is not an object (evaluating 'usage2.inputTokens.total')`

After fixing Bugs 2+3, text started streaming but OpenCode crashed on the first `finish` event. OpenCode's internal `asLanguageModelUsage(usage2)` reads `usage2.inputTokens.total` (hierarchical shape). If we emit `{inputTokens: undefined, ...}` it crashes because `undefined.total` is invalid.

**Fix:** both `doGenerate` and `doStream` now default `inputTokens`/`outputTokens` to `0` before emitting `finish`:

```ts
const inputTokens = usage?.input_tokens ?? 0;
const outputTokens = usage?.output_tokens ?? 0;
controller.enqueue({
  type: "finish",
  finishReason,
  usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
});
```

### Added safety nets

- `controllerClosed` flag prevents double-close races between `result` message and stdout `close`.
- `closeHandler` on the readline emitter emits a final `finish` if the subprocess exits before a `result` message.
- `reasoning-*` emission for `thinking` blocks (parity with reference plugin).

### Verification

```
opencode run --format json --model with-claude/sonnet "reply only with the word OK"
```

Emits `{"type":"text","text":"OK",...}` on every agent turn. `grep -c MaxListeners` = 0, `grep -c '"type":"error"'` = 0. Claude CLI subprocess spawns, streams back, `finish` closes cleanly.

The surrounding `Sisyphus (Ultraworker)` agent continues multi-stepping — that is **the user's agent configuration**, not a provider bug. Switching to a non-looping primary agent produces a single-turn response.

### Files touched this session

- `src/provider/with-claude-language-model.ts` — streaming fix (Bugs 2, 3, 4 + safety)
- `opencode.jsonc` — provider `npm` file URL fix (Bug 1)
- `src/tests/provider-config-contract.test.ts` — assertion updated (Bug 1)
- `Plan/HANDOFF.md` — this file
- Memory: `project_opencode_file_npm_spec.md`, `project_opencode_stream_quirks.md`

## Follow-up session 2026-04-09 — title-generation / TUI findings (historical)

> Diagnosis superseded by `Plan/LOOP_DIAGNOSIS_2026-04-10.md`. Fixes below still apply.

Three fixes landed, plus unixfox-style synthetic title handling:

1. **Subprocess cleanup after `result`** — both `doGenerate` / `doStream` release the Claude CLI subprocess after completed turns.
2. **False `tool-calls` finish reason** — `doStream` reports `"tool-calls"` only when a real tool-call part was emitted.
3. **Prompt-builder bug** (`src/provider/message-builder.ts`) — previously dropped non-user instructions when any user text existed; now preserves non-user context before user content and falls back correctly when no user message exists.
4. **Synthetic title handling** — `requestScope()` / `shouldSynthesizeTitle()` / `synthesizeTitle()` in `src/provider/with-claude-language-model.ts` short-circuit OpenCode title-generator prompts inside the provider (no Claude CLI spawn). Regression coverage in `src/tests/provider-runtime.test.ts`.

Config decisions kept from this session:
- `withClaudePrimary` local override was removed (OMO left intact).
- `agent.title.disable` removed again (title path now flows through provider-side synthesis).
- Only `implClaude`, `planClaude`, `reviewClaude` are exposed as subagents.

### Loop pattern (as observed 2026-04-09, now re-diagnosed)

```text
step=0 -> text "OK" -> step_finish
step=1 -> step_finish (0 tokens)
step=2 -> step_finish (0 tokens)
...
```

The 2026-04-09 conclusion ("must be upstream OpenCode behavior") was based on having ruled out: Claude CLI generation, provider stream parsing, subprocess cleanup, built-in title generation, default primary-agent selection. That rule-out was incomplete — the provider-side `finish` event shape was not inspected. See `Plan/LOOP_DIAGNOSIS_2026-04-10.md` for the actual root cause.

## Residual / optional next phase

1. **Fix the with-claude finish-event shape** ✅ fixed on 2026-04-10.

Final successful change:

- `src/provider/with-claude-language-model.ts`
  - runtime `specificationVersion` switched to v3-compatible emission (`"v3" as any`)
  - stream `finish` events now emit:
    - `finishReason: { unified: "stop", raw: "stop" }` (or tool-calls equivalent)
    - `rawFinishReason`
    - nested usage objects (`inputTokens.total`, `outputTokens.total`)
  - stream path also emits `response-metadata`
  - env-gated `WITH_CLAUDE_DEBUG_STREAM` logging retained for future protocol debugging

Regression coverage:

- `src/tests/provider-runtime.test.ts`
  - updated finish assertions for v3-style stream finish shape
  - response-metadata / providerMetadata coverage retained

Verification after the fix:

```bash
npm test
```

→ **36 tests pass**

```bash
opencode run --format json --model with-claude/sonnet --title "verify2" "reply only with the word OK"
```

→ returns cleanly with `OK`

SQLite verification on the latest session now shows:

```text
assistant|stop|{"total":6,"input":2,"output":4,...}
```

This confirms the previous failure mode is resolved:

- `finish` is no longer `NULL`
- tokens are no longer all zero
- OpenCode's loop exit condition is now satisfied for the minimal reproduction case

### Follow-up attempt — 2026-04-10 (3-attempt capped repair loop)

Three evidence-driven attempts were made after the re-diagnosis:

1. **Attempt 1 — stream finish logging**
   - Added `WITH_CLAUDE_DEBUG_STREAM` instrumentation in `src/provider/with-claude-language-model.ts`
   - Verified the provider really emits plain v2 finish events like:

   ```json
   {"type":"finish","finishReason":"stop","usage":{"inputTokens":2,"outputTokens":4,"totalTokens":6}}
   ```

   So the provider is not emitting `finishReason: undefined`; the loss happens downstream.

2. **Attempt 2 — unixfox parity patch**
   - Compared against `unixfox/opencode-claude-code-plugin`
   - Added `response-metadata` emission in stream mode
   - Added explicit `providerMetadata` on `finish`
   - Added regression assertions in `src/tests/provider-runtime.test.ts`

3. **Attempt 3 — real OpenCode verification**
   - `npm test` still passes (**36 tests**)
   - Real command still reproduces:

   ```bash
   WITH_CLAUDE_DEBUG_STREAM=/tmp/with-claude-debug-stream.jsonl \
   timeout 60 opencode run --log-level DEBUG --print-logs \
     --model with-claude/sonnet --title "verify" "reply only with the word OK"
   ```

   - DB check still shows repeated assistant messages with:
     - `finish = NULL`
     - `tokens = {input:0, output:0, reasoning:0, ...}`

Interpretation:

- The issue was **not** a missing v2 string emit from our provider.
- unixfox-style extra metadata alone was **not sufficient**.
- The successful fix was **Option B**: bypass the internal v2→v3 finish conversion by emitting a v3-compatible finish payload directly.

Files touched in this capped repair loop:

- `src/provider/with-claude-language-model.ts`
  - env-gated `WITH_CLAUDE_DEBUG_STREAM` logging
  - `response-metadata` emission in stream mode
  - explicit `providerMetadata` on stream `finish`
- `src/tests/provider-runtime.test.ts`
  - stream regression assertions for `response-metadata` / `providerMetadata`

2. **Subagent invocation caveat.** `opencode run --agent planClaude ...` falls back to the default agent because `planClaude` is a subagent, not primary. Validated usage:
   - TUI mention-style: `@planClaude`, `@implClaude`, `@reviewClaude`
   - **not** `opencode run --agent <subagent>`

   Additional command-surface note:

   - `.opencode/command/planClaude.md`, `.opencode/command/implClaude.md`, `.opencode/command/reviewClaude.md` now explicitly instruct the current primary agent to delegate to `@planClaude`, `@implClaude`, `@reviewClaude`.
   - Reason: the actual save behavior lives in the subagent tool path (`run_claude_plan`, `run_claude_implementation`, `run_claude_review`), not in plain free-text replies.
   - If a user runs a reusable command and only gets an answer without persistence, the likely cause is that the current primary agent did not delegate into the subagent/tool workflow.

   Plan artifact location was also updated:

   - `src/artifacts/markdown-artifacts.ts` now saves **plan markdown only** to:
     1. `.sisyphus/plans/plan-v<revision>.md` if `<workspaceRoot>/.sisyphus/plans` exists
     2. otherwise `plans/plan-v<revision>.md`
   - request / implementation / review artifacts remain under `.omd/plan/<taskId>/...`

   Verification:

   - `npm test` passes (**38 tests**)
   - direct manual checks after build produced:
     - with `.sisyphus/plans` present → `.sisyphus/plans/plan-v1.md`
     - without it → `plans/plan-v1.md`

3. **Portable `opencode.jsonc` `npm` field.** Currently an absolute machine path. Options: (a) build-time generator, (b) `npm pack` / `bun link`, (c) document "edit after clone".

4. **OpenCode agent wrappers.** Role wrappers (implClaude, planClaude, reviewClaude) still exist for discovery. Stricter CLI-only future could shrink wrapper intelligence further. Not required for current phase.

## Packaging / install status (2026-04-10)

The package has moved from "local project experiment" toward a distributable install flow.

### Current package state

- `package.json`
  - `name = @little_tale/opencode-with-claude`
  - `private: false`
  - `publishConfig.access = "public"`
  - `bin.opencode-with-claude = ./dist/cli.js`
  - `prepack = npm run build`
  - `files` whitelist limits the npm tarball to package/runtime assets
- `.npmignore`
  - present so npm does not fall back to `.gitignore` and accidentally drop `dist/`

### Installer behavior (current truth)

The installer is now **global**, not project-local.

Entry point:

```bash
npx @little_tale/opencode-with-claude install
```

Runtime implementation:

- `src/cli.ts` — npm bin entrypoint
- `src/install.ts` — global install logic

Install target:

- default config dir: `XDG_CONFIG_HOME/opencode` when set, otherwise `~/.config/opencode`
- overridable for testing with `--config-dir <path>`

What it writes:

- `~/.config/opencode/opencode.json`
  - merges in the `with-claude` provider
  - merges in `implClaude`, `planClaude`, `reviewClaude`
- `~/.config/opencode/.opencode/opencode-with-claude.jsonc`
- `~/.config/opencode/.opencode/agents/*.md`
- `~/.config/opencode/.opencode/command/*.md`

Important:

- installer no longer writes project-local `opencode.jsonc`
- installer no longer emits `opencode-with-claude.snippet.jsonc`
- existing global config fields are preserved and merged, not replaced wholesale

### Verification

All of the following were re-verified after the global installer switch:

```bash
npm test
```

→ **44 tests pass**

Packaged install verification:

```bash
npm run build
npm pack
npm exec --yes --package="file:./little-tale-opencode-with-claude-0.1.0.tgz" -- opencode-with-claude install --config-dir <tmpdir>
```

Observed output:

- installer reports successful global installation
- generated files include:
  - `opencode.json`
  - `.opencode/opencode-with-claude.jsonc`
  - `.opencode/agents/*.md`
  - `.opencode/command/*.md`

### README status

`README.md` is now aligned with the current installer behavior:

- install-first structure
- global OpenCode config wording
- packaged usage examples based on the verified installer path

### Recent packaging/install commits

- `05d4369` — Prepare package for npm distribution
- `c2f0d1a` — Add package installer for OpenCode setup
- `7addc18` — Ignore generated local artifacts
- `93dcd12` — Fix packaged installer entrypoint
- `5a2e19c` — Point package bin to the CLI wrapper
- `40cec53` — Rewrite README for package-first installation

## If you continue from here

Sanity check:

```bash
npm run build && npm test
```

Expected: 36 tests pass.

Reproduce the loop bug:

```bash
timeout 60 opencode run --log-level DEBUG --print-logs \
  --model with-claude/sonnet --title "verify" "reply only with the word OK" \
  > /tmp/verify.out 2> /tmp/verify.log

LATEST_SID=$(sqlite3 ~/.local/share/opencode/opencode.db \
  "SELECT id FROM session ORDER BY time_created DESC LIMIT 1;")
sqlite3 ~/.local/share/opencode/opencode.db \
  "SELECT id, json_extract(data, '\$.role'), json_extract(data, '\$.finish'), json_extract(data, '\$.tokens') FROM message WHERE session_id='$LATEST_SID';"
```

Success criteria after fix:
- assistant message's `finish` = `"stop"`
- session has ≤2 messages (one user, one assistant)
- `/tmp/verify.log` under ~1000 lines

Key entry points:
1. `src/provider/with-claude-language-model.ts` — `closeStream` (lines ~241-258) emits the `finish` event; likely fix site
2. `src/provider/session-manager.ts` — process reuse / session key logic
3. `src/opencode/plugin.ts` — plugin subpath workflow tools
4. `.opencode/opencode-with-claude.jsonc` — model/role config
5. `opencode.jsonc` — provider discovery (absolute `file://` URL)
