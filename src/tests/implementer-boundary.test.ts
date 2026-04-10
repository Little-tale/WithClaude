import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCommandImplementer } from "../agents/command-implementer.js";
import type { AppEnv } from "../config/env.js";
import type { WorkflowTask } from "../types/task.js";

function buildEnv(overrides: Partial<AppEnv>): AppEnv {
  return {
    PORT: 3000,
    DATA_DIR: "./data",
    IMPLEMENTER_COMMAND: undefined,
    IMPLEMENTER_ARGS: undefined,
    IMPLEMENTER_TIMEOUT_MS: 300000,
    IMPLEMENTER_ALLOW_RAW_STDOUT: false,
    IMPLEMENTER_MESSAGE_PREFIX: undefined,
    IMPLEMENTER_PROMPT_ARG_TEMPLATE: undefined,
    IMPLEMENTER_PROMPT_PREFIX: undefined,
    IMPLEMENTER_PROMPT_SUFFIX: undefined,
    IMPLEMENTER_WRITE_PROMPT_TO_STDIN: true,
    projectRoot: process.cwd(),
    dataFilePath: path.join(process.cwd(), "data", "tasks.json"),
    ...overrides
  };
}

function buildTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    taskId: "task-implementer-test",
    title: "Implementer Boundary",
    request: "Make the requested change",
    planText: "# Approved Plan\n\n- edit the code",
    requestedStage: "implement",
    routingMode: "sequential",
    source: "cli",
    workspaceRoot: process.cwd(),
    status: "implementing",
    planRevision: 1,
    requesterId: "cli:test",
    approvedBy: "reviewer",
    approvedAt: new Date().toISOString(),
    implementationSummary: null,
    reviewSummary: null,
    artifacts: {
      requestMarkdownPath: null,
      planMarkdownPath: null,
      implementationMarkdownPath: null,
      reviewMarkdownPath: null
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    ...overrides
  };
}

test("command-backed implementer preserves json text-event extraction and prompt templating", async () => {
  const env = buildEnv({
    IMPLEMENTER_COMMAND: process.execPath,
    IMPLEMENTER_ARGS: JSON.stringify([
      "-e",
      'const prompt = process.argv.at(-1) ?? ""; const response = { type: "text", part: { text: `# Implementation Summary\\n\\n${prompt.includes("@implClaude") ? "prompt-ok" : "prompt-missing"}` } }; process.stdout.write(JSON.stringify(response));'
    ]),
    IMPLEMENTER_MESSAGE_PREFIX: "@implClaude",
    IMPLEMENTER_PROMPT_ARG_TEMPLATE: "{{prompt}}",
    IMPLEMENTER_WRITE_PROMPT_TO_STDIN: false
  });

  const implementer = createCommandImplementer(env);
  assert.ok(implementer);

  const result = await implementer.runImplementation({ task: buildTask() });
  assert.equal(result.summary, "# Implementation Summary\n\nprompt-ok");
});

test("command-backed implementer uses workspaceRoot as cwd and falls back to projectRoot when missing", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-implementer-cwd-"));
  const env = buildEnv({
    IMPLEMENTER_COMMAND: process.execPath,
    IMPLEMENTER_ARGS: JSON.stringify([
      "-e",
      'process.stdout.write(JSON.stringify({ summary: process.cwd() }));'
    ]),
    IMPLEMENTER_WRITE_PROMPT_TO_STDIN: false
  });

  const implementer = createCommandImplementer(env);
  assert.ok(implementer);

  const workspaceResult = await implementer.runImplementation({ task: buildTask({ workspaceRoot }) });
  assert.match(String(workspaceResult.summary), new RegExp(`${path.basename(workspaceRoot)}$`));

  const fallbackResult = await implementer.runImplementation({ task: buildTask({ workspaceRoot: null }) });
  assert.equal(fallbackResult.summary, env.projectRoot);
});

test("command-backed implementer rejects invalid JSON output when raw stdout fallback is disabled", async () => {
  const env = buildEnv({
    IMPLEMENTER_COMMAND: process.execPath,
    IMPLEMENTER_ARGS: JSON.stringify([
      "-e",
      'process.stdout.write("not-json-output");'
    ]),
    IMPLEMENTER_WRITE_PROMPT_TO_STDIN: false,
    IMPLEMENTER_ALLOW_RAW_STDOUT: false
  });

  const implementer = createCommandImplementer(env);
  assert.ok(implementer);

  await assert.rejects(
    () => implementer.runImplementation({ task: buildTask() }),
    /Implementer command returned invalid JSON output|Unexpected token|No number after minus sign/
  );
});

test("command-backed implementer surfaces timeout and non-zero exit failures", async () => {
  const timeoutEnv = buildEnv({
    IMPLEMENTER_COMMAND: process.execPath,
    IMPLEMENTER_ARGS: JSON.stringify([
      "-e",
      'setTimeout(() => { process.stdout.write(JSON.stringify({ summary: "late" })); }, 100);'
    ]),
    IMPLEMENTER_WRITE_PROMPT_TO_STDIN: false,
    IMPLEMENTER_TIMEOUT_MS: 20
  });

  const timeoutImplementer = createCommandImplementer(timeoutEnv);
  assert.ok(timeoutImplementer);
  await assert.rejects(
    () => timeoutImplementer.runImplementation({ task: buildTask() }),
    /timed out after 20ms/
  );

  const exitEnv = buildEnv({
    IMPLEMENTER_COMMAND: process.execPath,
    IMPLEMENTER_ARGS: JSON.stringify([
      "-e",
      'process.stderr.write("boom"); process.exit(7);'
    ]),
    IMPLEMENTER_WRITE_PROMPT_TO_STDIN: false
  });

  const failingImplementer = createCommandImplementer(exitEnv);
  assert.ok(failingImplementer);
  await assert.rejects(
    () => failingImplementer.runImplementation({ task: buildTask() }),
    /Implementer command failed: boom/
  );
});
