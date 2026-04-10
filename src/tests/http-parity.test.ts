import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createOrchestrationHost } from "../orchestrator/host-factory.js";
import { createApp } from "../http/create-app.js";
import type { AppEnv } from "../config/env.js";

function buildEnv(projectRoot: string, overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    PORT: 3000,
    DATA_DIR: "./data",
    IMPLEMENTER_COMMAND: undefined,
    IMPLEMENTER_ARGS: undefined,
    IMPLEMENTER_TIMEOUT_MS: 300000,
    IMPLEMENTER_ALLOW_RAW_STDOUT: false,
    IMPLEMENTER_MESSAGE_PREFIX: "@implClaude",
    IMPLEMENTER_PROMPT_ARG_TEMPLATE: "{{prompt}}",
    IMPLEMENTER_PROMPT_PREFIX: undefined,
    IMPLEMENTER_PROMPT_SUFFIX: undefined,
    IMPLEMENTER_WRITE_PROMPT_TO_STDIN: false,
    projectRoot,
    dataFilePath: path.join(projectRoot, "data", "tasks.json"),
    ...overrides
  };
}

async function createTestApp() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-http-parity-"));
  const env = buildEnv(projectRoot);
  const host = createOrchestrationHost(env);
  const app = createApp(host);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind HTTP parity test server.");
  }
  return { app, host, projectRoot, server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function invokeJson(baseUrl: string, method: string, url: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return {
    status: response.status,
    json: await response.json() as Record<string, unknown>
  };
}

test("HTTP POST /tasks creates a draft task only", async () => {
  const { baseUrl, host, server } = await createTestApp();
  try {
    const result = await invokeJson(baseUrl, "POST", "/tasks", {
      title: "HTTP draft task",
      request: "Create only a draft"
    });

    assert.equal(result.status, 201);
    assert.equal(result.json.status, "draft_plan");
    assert.equal(result.json.planRevision, 0);

    const tasks = await host.listTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.status, "draft_plan");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await host.dispose();
  }
});

test("HTTP approve marks approval only and does not auto-run implementation/review", async () => {
  const { baseUrl, host, server } = await createTestApp();
  try {
    const created = await host.createTask({
      title: "HTTP approve task",
      request: "Approve only",
      requesterId: "http-user",
      source: "http",
      workspaceRoot: process.cwd()
    });
    const planned = await host.savePlanRevision(created.taskId, "planner", "# Approved Plan\n\n- first step");

    const result = await invokeJson(baseUrl, "POST", `/tasks/${planned.taskId}/approve`, {
      approverId: "http-approver"
    });

    assert.equal(result.status, 200);
    assert.equal(result.json.status, "implementing");
    assert.equal(result.json.implementationSummary, null);
    assert.equal(result.json.reviewSummary, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await host.dispose();
  }
});
