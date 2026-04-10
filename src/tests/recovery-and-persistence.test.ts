import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkflowOrchestrator } from "../orchestrator/orchestrator.js";
import { JsonTaskStore } from "../store/json-task-store.js";
import type { WorkflowTask } from "../types/task.js";

async function createStoreFile() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentwf-store-recovery-"));
  return path.join(dir, "tasks.json");
}

function buildTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    taskId: "task-recovery-test",
    title: "Recovery Test",
    request: "Persist me",
    planText: "# Plan\n\n- first step",
    requestedStage: "request",
    routingMode: "sequential",
    source: "cli",
    workspaceRoot: process.cwd(),
    status: "awaiting_approval",
    planRevision: 1,
    requesterId: "cli:test",
    approvedBy: null,
    approvedAt: null,
    implementationSummary: null,
    reviewSummary: null,
    artifacts: {
      requestMarkdownPath: ".omd/plan/task-recovery-test/request.md",
      planMarkdownPath: ".omd/plan/task-recovery-test/plan-v1.md",
      implementationMarkdownPath: null,
      reviewMarkdownPath: null
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    ...overrides
  };
}

test("truncated JSON task store content is recovered and rewritten", async () => {
  const filePath = await createStoreFile();
  const task = buildTask();
  const seedStore = new JsonTaskStore(filePath);
  await seedStore.save(task);

  const valid = await readFile(filePath, "utf8");
  await writeFile(filePath, `${valid}\n{"tasks":[`, "utf8");

  const store = new JsonTaskStore(filePath);
  const recovered = await store.list();

  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.taskId, task.taskId);

  const rewritten = await readFile(filePath, "utf8");
  assert.doesNotThrow(() => JSON.parse(rewritten));
});

test("persisted tasks normalize missing routing/source/artifact/thread fields on read", async () => {
  const filePath = await createStoreFile();
  const partialTask = {
    ...buildTask(),
    requestedStage: undefined,
    routingMode: undefined,
    source: undefined,
    workspaceRoot: undefined,
    artifacts: {}
  };

  await writeFile(filePath, JSON.stringify({ tasks: [partialTask] }, null, 2), "utf8");

  const store = new JsonTaskStore(filePath);
  const task = await store.get("task-recovery-test");

  assert.ok(task);
  assert.equal(task.requestedStage, "request");
  assert.equal(task.routingMode, "sequential");
  assert.equal(task.source, "http");
  assert.equal(task.workspaceRoot, null);
  assert.deepEqual(task.artifacts, {
    requestMarkdownPath: null,
    planMarkdownPath: null,
    implementationMarkdownPath: null,
    reviewMarkdownPath: null
  });
});

test("persisted tasks reload consistently through a fresh orchestrator instance", async () => {
  const filePath = await createStoreFile();
  const store = new JsonTaskStore(filePath);
  const orchestrator = new WorkflowOrchestrator(store);

  const created = await orchestrator.createTask({
    title: "Reloaded task",
    request: "Keep my state",
    requesterId: "cli:test",
    source: "cli",
    workspaceRoot: process.cwd()
  });
  const planned = await orchestrator.publishInitialPlan(created.taskId, "planner", "# Plan\n\n- first step", created.planRevision);

  const reloaded = new WorkflowOrchestrator(new JsonTaskStore(filePath));
  const task = await reloaded.getTask(planned.taskId);
  const tasks = await reloaded.listTasks();

  assert.ok(task);
  assert.equal(task.status, "awaiting_approval");
  assert.equal(task.planRevision, 1);
  assert.equal(task.planText, "# Plan\n\n- first step");
  assert.ok(tasks.some((entry) => entry.taskId === planned.taskId));
});
