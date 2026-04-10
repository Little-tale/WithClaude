import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MarkdownArtifactService } from "../artifacts/markdown-artifacts.js";
import type { WorkflowTask } from "../types/task.js";

function buildTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    taskId: "task-artifact-test",
    title: "Artifact Path Test",
    request: "Document artifact behavior",
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
    implementationSummary: "# Implementation Summary\n\n- changed files",
    reviewSummary: "# Review Summary\n\n- approved",
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

test("artifact path helpers preserve request/review .omd semantics", () => {
  const service = new MarkdownArtifactService("/tmp/fallback-root");

  assert.equal(service.requestArtifactPath("task-abc123"), ".omd/plan/task-abc123/request.md");
  assert.equal(service.planArtifactPath("task-abc123", 2, ".sisyphus/plans"), ".sisyphus/plans/plan-v2.md");
  assert.equal(service.planArtifactPath("task-abc123", 2, "plans"), "plans/plan-v2.md");
  assert.equal(service.implementationArtifactPath("task-abc123"), ".omd/plan/task-abc123/implementation-summary.md");
  assert.equal(service.reviewArtifactPath("task-abc123"), ".omd/plan/task-abc123/review-summary.md");
});

test("request artifact uses .omd and plan artifact prefers .sisyphus/plans when present", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-artifacts-workspace-"));
  const fallbackRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-artifacts-fallback-"));
  const service = new MarkdownArtifactService(fallbackRoot);
  const task = buildTask({ taskId: "task-workspace-root", workspaceRoot });

  await mkdir(path.join(workspaceRoot, ".sisyphus", "plans"), { recursive: true });

  const request = await service.writeRequestArtifact(task);
  const plan = await service.writePlanArtifact(task);

  assert.equal(request.artifactPath, ".omd/plan/task-workspace-root/request.md");
  assert.equal(plan.artifactPath, ".sisyphus/plans/plan-v1.md");

  const requestBody = await readFile(path.join(workspaceRoot, request.artifactPath), "utf8");
  const planBody = await readFile(path.join(workspaceRoot, plan.artifactPath), "utf8");
  assert.match(requestBody, /## Original request/);
  assert.match(planBody, /# Plan · task-workspace-root/);
});

test("plan artifact falls back to plans when .sisyphus/plans is absent", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-artifacts-plan-fallback-"));
  const fallbackRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-artifacts-plan-fallback-root-"));
  const service = new MarkdownArtifactService(fallbackRoot);
  const task = buildTask({ taskId: "task-plan-fallback", workspaceRoot });

  const plan = await service.writePlanArtifact(task);

  assert.equal(plan.artifactPath, "plans/plan-v1.md");
  const planBody = await readFile(path.join(workspaceRoot, plan.artifactPath), "utf8");
  assert.match(planBody, /# Plan · task-plan-fallback/);
});

test("artifact writes fall back to the service root when workspaceRoot is null", async () => {
  const fallbackRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-artifacts-fallback-only-"));
  const service = new MarkdownArtifactService(fallbackRoot);
  const task = buildTask({ taskId: "task-fallback-root", workspaceRoot: null });

  const implementation = await service.writeImplementationArtifact(task);
  const review = await service.writeReviewArtifact(task);

  const implementationPath = path.join(fallbackRoot, implementation.artifactPath);
  const reviewPath = path.join(fallbackRoot, review.artifactPath);
  const implementationBody = await readFile(implementationPath, "utf8");
  const reviewBody = await readFile(reviewPath, "utf8");

  assert.match(implementationBody, /# Implementation Summary · task-fallback-root/);
  assert.match(reviewBody, /# Review Summary · task-fallback-root/);
});
