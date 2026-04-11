# Contribution Guide

Thanks for helping improve `@little_tale/opencode-with-claude`.

## Before you start

- use Node.js 22+
- install dependencies with `npm install`
- build once with `npm run build`
- run tests with `npm test`

## Local development flow

1. create a branch for your change
2. make the smallest change that solves the problem
3. run `npm run build`
4. run `npm test`
5. update docs when behavior or install steps change

## What this repository ships

This package centers on two install surfaces:

- the Claude-backed provider runtime in `dist/`
- bundled OpenCode agents and command prompts in `.opencode/`

When you change installer behavior, config shape, or agent prompts, update the related top-level docs too:

- `README.md`
- `AGENT_INSTALL.md`
- `LICENSE` when licensing changes

## Documentation expectations

- keep human-facing setup concise in `README.md`
- keep agent-facing setup explicit and step-by-step in `AGENT_INSTALL.md`
- prefer repo-local markdown references over external install links when instructing agents

## Pull request checklist

Before opening a PR, make sure you:

- explain why the change is needed
- mention any installer or config migration impact
- include doc updates for user-visible behavior
- confirm `npm test` passes locally
