import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ImplementerAdapter, ReviewerAdapter } from "../agents/types.js";
import { runPlannerStage } from "../orchestrator/pipeline.js";
import { WorkflowOrchestrator } from "../orchestrator/orchestrator.js";
import { JsonTaskStore } from "../store/json-task-store.js";

async function createOrchestrator() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentwf-plan-regression-"));
  return new WorkflowOrchestrator(new JsonTaskStore(path.join(dir, "tasks.json")));
}

const unusedImplementer: ImplementerAdapter = {
  name: "unused-implementer",
  async runImplementation() {
    return { summary: "unused" };
  }
};

const unusedReviewer: ReviewerAdapter = {
  name: "unused-reviewer",
  async runReview() {
    return { decision: "approved", summary: "unused" };
  }
};

test("stale initial plan publish is rejected once a newer revision exists", async () => {
  const orchestrator = await createOrchestrator();
  const created = await orchestrator.createTask({
    title: "Stale initial plan",
    request: "Create a plan",
    requesterId: "cli:test",
    source: "cli",
    workspaceRoot: process.cwd()
  });

  const planned = await orchestrator.publishInitialPlan(created.taskId, "planner", "# Plan v1", created.planRevision);
  await assert.rejects(
    () => orchestrator.publishInitialPlan(created.taskId, "planner", "# stale", created.planRevision),
    /Cannot publish initial plan while task is in state 'awaiting_approval'./
  );

  await assert.rejects(
    () => orchestrator.applyPlanRevision(planned.taskId, "planner", "# stale revision", "feedback", created.planRevision),
    /Stale plan revision/
  );
});

test("duplicate planning attempts are rejected by the single-flight guard", async () => {
  const orchestrator = await createOrchestrator();
  const created = await orchestrator.createTask({
    title: "Concurrent planning",
    request: "Generate one plan",
    requesterId: "cli:test",
    source: "cli",
    workspaceRoot: process.cwd()
  });

  let releasePlanning!: () => void;
  const plannerGate = new Promise<void>((resolve) => {
    releasePlanning = resolve;
  });

  const deps = {
    orchestrator,
    planner: {
      name: "test-planner",
      async runPlanning() {
        await plannerGate;
        return { planText: "# Generated plan" };
      }
    },
    implementer: unusedImplementer,
    reviewer: unusedReviewer
  };

  const firstRun = runPlannerStage(created, deps);
  await Promise.resolve();

  await assert.rejects(() => runPlannerStage(created, deps), /Planning already in progress/);

  releasePlanning();
  const planned = await firstRun;
  assert.equal(planned.status, "awaiting_approval");
  assert.equal(planned.planRevision, 1);
});
