import { randomUUID } from "node:crypto";

import type { CreateTaskInput, ReviewDecision, TaskArtifacts, TaskHistoryEntry, TaskStatus, WorkflowTask } from "../types/task.js";
import { JsonTaskStore } from "../store/json-task-store.js";

function nowIso(): string {
  return new Date().toISOString();
}

function historyEntry(type: TaskHistoryEntry["type"], actorId: string, note?: string): TaskHistoryEntry {
  return {
    at: nowIso(),
    type,
    actorId,
    note
  };
}

export class WorkflowOrchestrator {
  constructor(private readonly store: JsonTaskStore) {}

  async listTasks(): Promise<WorkflowTask[]> {
    return this.store.list();
  }

  async getTask(taskId: string): Promise<WorkflowTask | null> {
    return this.store.get(taskId);
  }

  async createTask(input: CreateTaskInput): Promise<WorkflowTask> {
    const timestamp = nowIso();
    const task: WorkflowTask = {
      taskId: `task-${randomUUID().slice(0, 8)}`,
      title: input.title,
      request: input.request,
      planText: "",
      requestedStage: input.requestedStage ?? "request",
      routingMode: input.routingMode ?? "sequential",
      source: input.source ?? "http",
      workspaceRoot: input.workspaceRoot ?? null,
      status: "draft_plan",
      planRevision: 0,
      requesterId: input.requesterId,
      approvedBy: null,
      approvedAt: null,
      implementationSummary: null,
      reviewSummary: null,
      artifacts: {
        requestMarkdownPath: null,
        planMarkdownPath: null,
        implementationMarkdownPath: null,
        reviewMarkdownPath: null
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      history: [historyEntry("created", input.requesterId, "Task created and waiting for generated plan")]
    };

    await this.store.save(task);
    return task;
  }

  async revisePlan(taskId: string, actorId: string, planText: string): Promise<WorkflowTask> {
    const task = await this.requireTask(taskId);

    if (task.status !== "awaiting_approval" && task.status !== "draft_plan") {
      throw new Error("Plan can only be revised before approval.");
    }

    task.planRevision += 1;
    task.planText = planText;
    task.updatedAt = nowIso();
    task.history.push(historyEntry("plan_revised", actorId, `Plan revision ${task.planRevision}`));

    await this.store.save(task);
    return task;
  }

  async publishInitialPlan(
    taskId: string,
    actorId: string,
    planText: string,
    expectedPlanRevision: number
  ): Promise<WorkflowTask> {
    const task = await this.requireTask(taskId);

    if (task.status !== "draft_plan") {
      throw new Error(`Cannot publish initial plan while task is in state '${task.status}'.`);
    }

    if (task.planRevision !== expectedPlanRevision) {
      throw new Error(
        `Stale initial plan for ${taskId}: expected revision ${expectedPlanRevision}, found ${task.planRevision}.`
      );
    }

    task.planRevision = expectedPlanRevision + 1;
    task.planText = planText;
    task.status = "awaiting_approval";
    task.updatedAt = nowIso();
    task.history.push(historyEntry("plan_revised", actorId, `Initial plan published as revision ${task.planRevision}`));
    task.history.push(historyEntry("status_changed", actorId, "Transitioned to awaiting_approval"));

    await this.store.save(task);
    return task;
  }

  async approveTask(taskId: string, approverId: string): Promise<WorkflowTask> {
    const task = await this.requireTask(taskId);

    if (task.status !== "awaiting_approval") {
      throw new Error("Only awaiting_approval tasks can be approved.");
    }

    const approvedAt = nowIso();
    task.approvedBy = approverId;
    task.approvedAt = approvedAt;
    task.history.push(historyEntry("approved", approverId, `Approved revision ${task.planRevision}`));
    task.status = "implementing";
    task.history.push(historyEntry("status_changed", approverId, "Transitioned to implementing"));
    task.updatedAt = approvedAt;

    await this.store.save(task);
    return task;
  }

  async applyPlanRevision(
    taskId: string,
    actorId: string,
    planText: string,
    feedback?: string,
    expectedPlanRevision?: number
  ): Promise<WorkflowTask> {
    const task = await this.requireTask(taskId);

    const allowed: TaskStatus[] = ["awaiting_approval", "draft_plan", "rejected"];
    if (!allowed.includes(task.status)) {
      throw new Error(`Cannot apply plan revision while task is in state '${task.status}'.`);
    }

    if (typeof expectedPlanRevision === "number" && task.planRevision !== expectedPlanRevision) {
      throw new Error(
        `Stale plan revision for ${taskId}: expected revision ${expectedPlanRevision}, found ${task.planRevision}.`
      );
    }

    const at = nowIso();
    task.planRevision += 1;
    task.planText = planText;
    task.status = "awaiting_approval";
    task.approvedBy = null;
    task.approvedAt = null;
    task.updatedAt = at;
    task.history.push(historyEntry("plan_revised", actorId, feedback ? `Plan revision ${task.planRevision} (feedback): ${feedback.slice(0, 120)}` : `Plan revision ${task.planRevision}`));
    task.history.push(historyEntry("status_changed", actorId, "Transitioned to awaiting_approval"));

    await this.store.save(task);
    return task;
  }

  async rejectPlan(taskId: string, actorId: string, reason?: string): Promise<WorkflowTask> {
    const task = await this.requireTask(taskId);

    if (task.status !== "awaiting_approval" && task.status !== "draft_plan") {
      throw new Error("Only awaiting_approval or draft_plan tasks can be rejected at the plan stage.");
    }

    const at = nowIso();
    task.status = "rejected";
    task.updatedAt = at;
    task.history.push(historyEntry("status_changed", actorId, `Plan rejected${reason ? `: ${reason}` : ""}`));

    await this.store.save(task);
    return task;
  }

  async saveImplementationSummary(taskId: string, actorId: string, summary: string): Promise<WorkflowTask> {
    const task = await this.requireTask(taskId);

    if (task.status !== "implementing") {
      throw new Error("Implementation summary can only be saved while implementing.");
    }

    task.implementationSummary = summary;
    task.status = "reviewing";
    task.updatedAt = nowIso();
    task.history.push(historyEntry("implementation_saved", actorId, "Implementation summary saved"));
    task.history.push(historyEntry("status_changed", actorId, "Transitioned to reviewing"));

    await this.store.save(task);
    return task;
  }

  async updateArtifacts(taskId: string, actorId: string, artifacts: Partial<TaskArtifacts>): Promise<WorkflowTask> {
    const task = await this.requireTask(taskId);
    task.artifacts = {
      ...task.artifacts,
      ...artifacts
    };
    task.updatedAt = nowIso();
    task.history.push(historyEntry("artifacts_updated", actorId, `Updated artifacts: ${Object.keys(artifacts).join(", ")}`));
    await this.store.save(task);
    return task;
  }

  async recordReview(taskId: string, actorId: string, decision: ReviewDecision, summary: string): Promise<WorkflowTask> {
    const task = await this.requireTask(taskId);

    if (task.status !== "reviewing") {
      throw new Error("Review can only be recorded while reviewing.");
    }

    task.reviewSummary = summary;
    task.status = decision === "approved" ? "done" : "rejected";
    task.updatedAt = nowIso();
    task.history.push(historyEntry("review_recorded", actorId, `Review ${decision}`));
    task.history.push(historyEntry("status_changed", actorId, `Transitioned to ${task.status}`));

    await this.store.save(task);
    return task;
  }

  private async requireTask(taskId: string): Promise<WorkflowTask> {
    const task = await this.store.get(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    return task;
  }
}
