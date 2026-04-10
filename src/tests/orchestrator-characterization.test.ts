import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkflowOrchestrator } from "../orchestrator/orchestrator.js";
import { JsonTaskStore } from "../store/json-task-store.js";

async function createOrchestrator() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentwf-orch-characterization-"));
  return new WorkflowOrchestrator(new JsonTaskStore(path.join(dir, "tasks.json")));
}

test("happy-path lifecycle remains draft_plan -> awaiting_approval -> implementing -> reviewing -> done", async () => {
  const orchestrator = await createOrchestrator();
  const created = await orchestrator.createTask({
    title: "Lifecycle happy path",
    request: "Implement the approved change",
    requesterId: "cli:test",
    source: "cli",
    workspaceRoot: process.cwd()
  });

  assert.equal(created.status, "draft_plan");
  assert.equal(created.planRevision, 0);
  assert.equal(created.history.at(-1)?.type, "created");

  const planned = await orchestrator.publishInitialPlan(created.taskId, "planner", "# Plan v1", created.planRevision);
  assert.equal(planned.status, "awaiting_approval");
  assert.equal(planned.planRevision, 1);
  assert.equal(planned.planText, "# Plan v1");

  const approved = await orchestrator.approveTask(planned.taskId, "discord:user");
  assert.equal(approved.status, "implementing");
  assert.equal(approved.approvedBy, "discord:user");
  assert.ok(approved.approvedAt);

  const implemented = await orchestrator.saveImplementationSummary(approved.taskId, "claude", "# Implementation Summary\n\n- changed files");
  assert.equal(implemented.status, "reviewing");
  assert.equal(implemented.implementationSummary, "# Implementation Summary\n\n- changed files");

  const reviewed = await orchestrator.recordReview(implemented.taskId, "oracle", "approved", "# Review Summary\n\nLooks good.");
  assert.equal(reviewed.status, "done");
  assert.equal(reviewed.reviewSummary, "# Review Summary\n\nLooks good.");

  assert.deepEqual(
    reviewed.history.map((entry) => entry.type),
    [
      "created",
      "plan_revised",
      "status_changed",
      "approved",
      "status_changed",
      "implementation_saved",
      "status_changed",
      "review_recorded",
      "status_changed"
    ]
  );
});

test("plan-stage rejection preserves rejected status and review-stage rejection also ends as rejected", async () => {
  const orchestrator = await createOrchestrator();
  const created = await orchestrator.createTask({
    title: "Lifecycle rejection path",
    request: "Reject this plan",
    requesterId: "cli:test",
    source: "cli",
    workspaceRoot: process.cwd()
  });

  const planned = await orchestrator.publishInitialPlan(created.taskId, "planner", "# Plan v1", created.planRevision);
  const rejectedPlan = await orchestrator.rejectPlan(planned.taskId, "discord:reviewer", "not enough detail");
  assert.equal(rejectedPlan.status, "rejected");
  assert.equal(rejectedPlan.history.at(-1)?.type, "status_changed");

  const revised = await orchestrator.applyPlanRevision(rejectedPlan.taskId, "planner", "# Plan v2", "more detail", rejectedPlan.planRevision);
  const approved = await orchestrator.approveTask(revised.taskId, "discord:user");
  const implemented = await orchestrator.saveImplementationSummary(approved.taskId, "claude", "implemented");
  const rejectedReview = await orchestrator.recordReview(implemented.taskId, "oracle", "rejected", "needs changes");

  assert.equal(rejectedReview.status, "rejected");
  assert.equal(rejectedReview.reviewSummary, "needs changes");
});
