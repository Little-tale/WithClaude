import type { ImplementerAdapter, PlannerAdapter, ReviewerAdapter } from "../agents/types.js";
import { MarkdownArtifactService } from "../artifacts/markdown-artifacts.js";
import type { WorkflowTask } from "../types/task.js";
import { WorkflowOrchestrator } from "./orchestrator.js";

export type PipelineEffects = {
  postPlanRevision?: (task: WorkflowTask, feedback: string) => Promise<void>;
};

export type PipelineDeps = {
  orchestrator: WorkflowOrchestrator;
  planner: PlannerAdapter;
  implementer: ImplementerAdapter;
  reviewer: ReviewerAdapter;
  artifacts?: MarkdownArtifactService;
};

export type PostApprovalRunner = (task: WorkflowTask) => Promise<WorkflowTask>;
export type PostCreateRunner = (task: WorkflowTask) => Promise<WorkflowTask>;
export type PlanRevisionRunner = (taskId: string, feedback: string, actorId: string) => Promise<WorkflowTask>;

const planningTasks = new Set<string>();

async function runSingleFlightPlanning(taskId: string, runner: () => Promise<WorkflowTask>): Promise<WorkflowTask> {
  if (planningTasks.has(taskId)) {
    throw new Error(`Planning already in progress for ${taskId}.`);
  }

  planningTasks.add(taskId);
  try {
    return await runner();
  } finally {
    planningTasks.delete(taskId);
  }
}

function isRetrievable(task: WorkflowTask | null): task is WorkflowTask {
  return task !== null;
}

export function createPostApprovalRunner(deps: PipelineDeps): PostApprovalRunner {
  return (task) => runPostApprovalPipeline(task, deps);
}

export function createPostCreateRunner(deps: PipelineDeps): PostCreateRunner {
  return (task) => runPlannerStage(task, deps);
}

export function createPlanRevisionRunner(deps: PipelineDeps): PlanRevisionRunner {
  return (taskId, feedback, actorId) => runPlanRevisionPipeline(taskId, feedback, actorId, deps);
}

export async function runPlanRevisionPipeline(
  taskId: string,
  feedback: string,
  actorId: string,
  deps: PipelineDeps
): Promise<WorkflowTask> {
  return runSingleFlightPlanning(taskId, async () => {
    const { orchestrator, planner, artifacts } = deps;
    const current = await orchestrator.getTask(taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const expectedPlanRevision = current.planRevision;
    const planResult = await planner.runPlanning({ task: current, feedback });
    let task = await orchestrator.applyPlanRevision(
      taskId,
      actorId,
      planResult.planText,
      feedback,
      expectedPlanRevision
    );

    if (artifacts) {
      const artifactUpdate = await artifacts.syncPlanArtifact(task);
      task = await orchestrator.updateArtifacts(task.taskId, actorId, artifactUpdate);
    }

    return task;
  });
}

export async function runPlannerStage(
  createdTask: WorkflowTask,
  deps: PipelineDeps
): Promise<WorkflowTask> {
  return runSingleFlightPlanning(createdTask.taskId, async () => {
    const { orchestrator, planner, artifacts } = deps;
    let task = createdTask;

    if (task.status !== "draft_plan") {
      return task;
    }

    if (artifacts) {
      const requestArtifact = await artifacts.syncRequestArtifact(task);
      task = await orchestrator.updateArtifacts(task.taskId, planner.name, requestArtifact);
    }

    const expectedPlanRevision = task.planRevision;
    const result = await planner.runPlanning({ task });
    task = await orchestrator.publishInitialPlan(task.taskId, planner.name, result.planText, expectedPlanRevision);

    if (artifacts) {
      const planArtifact = await artifacts.syncPlanArtifact(task);
      task = await orchestrator.updateArtifacts(task.taskId, planner.name, planArtifact);
    }

    return task;
  });
}

export async function runPostApprovalPipeline(
  approvedTask: WorkflowTask,
  deps: PipelineDeps
): Promise<WorkflowTask> {
  const { orchestrator, implementer, reviewer, artifacts } = deps;
  let task = approvedTask;

  if (task.status !== "implementing") {
    return task;
  }

  const implResult = await implementer.runImplementation({ task });
  task = await orchestrator.saveImplementationSummary(task.taskId, implementer.name, implResult.summary);

  if (artifacts) {
    const implementationArtifact = await artifacts.syncImplementationArtifact(task);
    task = await orchestrator.updateArtifacts(task.taskId, implementer.name, implementationArtifact);
  }

  const reviewResult = await reviewer.runReview({ task });
  task = await orchestrator.recordReview(task.taskId, reviewer.name, reviewResult.decision, reviewResult.summary);

  if (artifacts) {
    const reviewArtifact = await artifacts.syncReviewArtifact(task);
    task = await orchestrator.updateArtifacts(task.taskId, reviewer.name, reviewArtifact);
  }

  return task;
}
