import { MarkdownArtifactService } from "../artifacts/markdown-artifacts.js";
import type { AppEnv } from "../config/env.js";
import type { CreateTaskInput, ReviewDecision, TaskArtifacts, WorkflowTask } from "../types/task.js";
import { WorkflowOrchestrator } from "./orchestrator.js";

export type OrchestrationHost = {
  env: AppEnv;
  orchestrator: WorkflowOrchestrator;
  artifacts: MarkdownArtifactService;
  listTasks: () => Promise<WorkflowTask[]>;
  getTask: (taskId: string) => Promise<WorkflowTask | null>;
  createTask: (input: CreateTaskInput) => Promise<WorkflowTask>;
  approveOnly: (taskId: string, approverId: string) => Promise<WorkflowTask>;
  savePlanRevision: (taskId: string, actorId: string, planText: string) => Promise<WorkflowTask>;
  rejectPlan: (taskId: string, actorId: string, reason?: string) => Promise<WorkflowTask>;
  saveImplementationSummary: (taskId: string, actorId: string, summary: string) => Promise<WorkflowTask>;
  recordReview: (taskId: string, actorId: string, decision: ReviewDecision, summary: string) => Promise<WorkflowTask>;
  updateArtifacts: (taskId: string, actorId: string, artifacts: Partial<TaskArtifacts>) => Promise<WorkflowTask>;
  dispose: () => Promise<void>;
};
