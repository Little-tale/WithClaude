# OMOA Claude CLI Integration Plan

## Goal

Integrate our own Claude CLI-based provider into oh-my-openagent (OMOA) so selected agents can use Claude models through **our provider/runtime**, not Anthropic API.

Primary target agents:

- `Sisyphus`
- `Atlas`

Secondary / deferred target:

- `Hephaestus`

## Bottom Line

This is feasible if Claude CLI is added as a **first-class OMOA provider adapter** rather than being disguised as `anthropic`. The recommended MVP is to wire a distinct provider namespace, map provider-qualified Claude model IDs into OMOA's existing model-resolution path, and roll out only to `Sisyphus` and `Atlas` first. `Hephaestus` should stay out of the first rollout because of its non-GPT / provider restrictions.

## Evidence Summary

### From the local Claude CLI project

The current local repo already proves the core provider pattern:

- `src/provider/index.ts`
  - exposes `createWithClaude()`
  - returns a provider object that creates models by model ID
- `src/provider/with-claude-language-model.ts`
  - implements the model runtime
  - shells out to Claude CLI
  - parses streaming output
  - maps tool calls/results into the host model interface
- `src/agents/claude-cli.ts`
  - supports direct role-based Claude CLI invocation with structured JSON output
- `src/opencode/plugin.ts`
  - shows role/subagent-level model override patterns

This means the hard part — making Claude CLI behave like a provider-backed model runtime — is already demonstrated.

### From OMOA analysis

OMOA already has:

- provider/model resolution
- per-agent model overrides
- fallback chains
- model/provider-aware routing

Important agent-specific observations from the gathered analysis:

- `Sisyphus` is Claude-friendly
- `Atlas` is Claude-friendly
- `Hephaestus` has extra provider / non-GPT constraints and should be treated as a separate integration track

## Recommended Architecture

### 1. Add a distinct provider namespace

Do **not** impersonate `anthropic`.

Recommended provider keys:

- `with-claude`
  - best if we want parity with the existing local implementation
- or `claude-cli`
  - best if we want the namespace to explicitly reflect the runtime source

Recommendation: **prefer `with-claude` if OMOA can accept it cleanly**, because that matches the existing local provider implementation and reduces translation work.

What must not happen:

- no aliasing Claude CLI-backed models to `anthropic/...` as the primary identity
- no silent substitution between Claude CLI and Anthropic API

Reason:

- observability becomes ambiguous
- fallback behavior becomes misleading
- provider intent is lost

### 2. Use provider-qualified model IDs

Use explicit IDs such as:

- `with-claude/opus`
- `with-claude/sonnet`
- optionally `with-claude/haiku`

If OMOA expects more canonical long-form names, support alias normalization internally, but keep the provider namespace distinct.

Possible alias strategy:

- incoming friendly name: `opus`
- normalized OMOA-facing name: `with-claude/opus`

Do not normalize to:

- `anthropic/claude-opus-4-6`
- `anthropic/claude-sonnet-4-6`

unless that is only a display alias and never the resolved runtime identity.

### 3. Reuse OMOA's existing per-agent override path

The cleanest rollout path is not “teach every agent about Claude CLI.”

It is:

1. register the new provider in OMOA's provider/discovery layer
2. make model resolution accept the new provider IDs
3. set per-agent model overrides for selected agents

That keeps the integration inside OMOA's existing architecture instead of adding custom branches in agent implementations.

### 4. Limit MVP to Sisyphus and Atlas

These are the correct first targets because the gathered evidence already points to them as Claude-friendly.

Recommended MVP mapping:

- `Sisyphus` → `with-claude/opus`
- `Atlas` → `with-claude/sonnet`

This gives us one high-capability reasoning agent and one lighter Claude-backed agent to validate the provider behavior across two agent styles.

### 5. Defer Hephaestus

`Hephaestus` should not be in the first rollout.

Reason:

- it has provider / GPT-oriented restrictions
- even if model override syntax accepts the value, runtime assumptions may still break correctness
- “model runs” is not the same as “agent remains valid”

Hephaestus should only be attempted after:

- provider registration is stable
- model resolution is deterministic
- stream / tool semantics are verified
- explicit non-GPT capability checks are understood

## Minimum Viable Rollout Plan

### Phase 1 — Integration Spike

Objective:

Prove that OMOA can see and resolve the Claude CLI provider as a separate provider.

Tasks:

1. Identify OMOA provider registration / discovery seam.
2. Add a new provider namespace for our Claude CLI runtime.
3. Connect that provider to the existing local runtime pattern:
   - provider factory
   - model creation
   - stream parsing
   - cancellation / stop behavior
   - error propagation
4. Verify that OMOA resolves explicit model IDs like `with-claude/opus`.

Success criteria:

- OMOA recognizes the provider
- explicit agent model override resolves to Claude CLI
- one smoke run completes without provider confusion

### Phase 2 — Sisyphus / Atlas MVP

Objective:

Enable Claude CLI for two selected agents using opt-in overrides only.

Tasks:

1. Configure `Sisyphus` with `with-claude/opus`.
2. Configure `Atlas` with `with-claude/sonnet`.
3. Validate end-to-end behavior for:
   - model selection
   - stream handling
   - final response assembly
   - error handling
   - retry behavior if applicable
4. Confirm no silent fallback into Anthropic API or other providers.

Success criteria:

- both agents complete representative tasks
- logs / metadata show the Claude CLI provider was actually used
- no provider ambiguity in telemetry or debugging output

### Phase 3 — Fallback Policy Hardening

Objective:

Make fallback behavior explicit and safe.

Tasks:

1. Define whether same-provider fallback is supported.
2. If supported, allow only explicit same-provider fallbacks such as:
   - `with-claude/opus` → `with-claude/sonnet`
3. If not configured, fail fast.
4. Prevent hidden fallback to Anthropic API or OpenAI when Claude CLI was explicitly requested.

Success criteria:

- provider intent is preserved
- fallback behavior is inspectable and deterministic

### Phase 4 — Hephaestus Investigation

Objective:

Decide whether Hephaestus can support Claude CLI at all without degrading correctness.

Tasks:

1. Audit Hephaestus non-GPT/provider guard behavior.
2. Identify whether the restriction is:
   - pure config validation
   - provider allowlist
   - prompt/runtime contract assumption
3. If needed, introduce a capability gate instead of a blanket provider rejection.
4. Run a dedicated Hephaestus compatibility validation.

Success criteria:

- we know whether support is viable
- no accidental broad rollout

## Likely Integration Layers in OMOA

Exact file edits depend on the OMOA source tree, but the plan should target these layers:

1. **Provider registration/discovery layer**
   - where providers become visible to model resolution
2. **Model normalization / resolution layer**
   - where `provider/model` IDs are parsed and selected
3. **Per-agent override configuration layer**
   - where agent-specific model assignments are declared
4. **Runtime adapter layer**
   - where an OMOA model/provider contract is backed by our Claude CLI runtime
5. **Capability / validation layer**
   - especially for Hephaestus restrictions

Do **not** start by changing all agent implementations.

The provider/model resolution seam is the correct entry point.

## Validation Strategy

### Contract tests

Validate the adapter for:

- streaming
- cancellation
- stop reason propagation
- structured error propagation
- tool-call event handling

### Resolution tests

Validate:

- explicit override to `with-claude/opus`
- explicit override to `with-claude/sonnet`
- unsupported model behavior
- fallback behavior when configured vs not configured

### Agent smoke tests

Run at least one representative task each for:

- `Sisyphus`
- `Atlas`

Do not include `Hephaestus` in MVP smoke tests.

## Biggest Risks

### 1. Runtime contract mismatch

The Claude CLI runtime may be correct in the local OpenCode context but still not fully match OMOA expectations around:

- stream lifecycle
- cancellation timing
- tool boundaries
- final message completion rules

### 2. Model identity ambiguity

If Claude CLI models are made to look like Anthropic models, OMOA may appear to “work” while actually obscuring which provider executed the run.

### 3. Hidden cross-provider fallback

If OMOA falls back from Claude CLI to Anthropic API or OpenAI without an explicit policy, the experiment becomes invalid.

### 4. Hephaestus assumptions

Hephaestus may depend on GPT/provider-specific prompt or runtime behavior in ways that a simple model swap does not satisfy.

## What Must Be True for Success

1. Claude CLI is exposed as a **distinct provider**, not an impersonated one.
2. OMOA model resolution can deterministically select that provider.
3. Per-agent overrides can target the new provider without custom agent hacks.
4. Sisyphus and Atlas can complete representative workflows through the new provider.
5. Fallback behavior remains explicit and inspectable.

## Recommended Initial Configuration Shape

Illustrative example only:

```jsonc
{
  "agents": {
    "sisyphus": {
      "model": "with-claude/opus"
    },
    "atlas": {
      "model": "with-claude/sonnet"
    }
  }
}
```

If OMOA requires fallback declaration too, keep it same-provider only at first.

## Explicit Non-Goals for MVP

- no global replacement of Anthropic API
- no attempt to make Claude CLI appear as native Anthropic
- no Hephaestus support in the first milestone
- no broad rollout to all agents before contract validation

## Effort Estimate

- **Medium (1–2 days)** for an MVP limited to provider registration + Sisyphus/Atlas validation
- **Large** if Hephaestus parity is included in the same iteration

## Recommended Final Decision

Proceed with a **provider-first MVP**:

1. add Claude CLI as a distinct provider in OMOA
2. expose provider-qualified model IDs
3. wire only `Sisyphus` and `Atlas` first
4. validate runtime contract and fallback semantics
5. treat `Hephaestus` as a separate follow-up track

This path matches both the existing local Claude CLI provider architecture and the OMOA model-resolution architecture without conflating Claude CLI with Anthropic API.
