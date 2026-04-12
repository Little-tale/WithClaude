import { MarkdownArtifactService } from "../artifacts/markdown-artifacts.js";
import type { AppEnv } from "../config/env.js";
import { WorkflowOrchestrator } from "./orchestrator.js";
import type { OrchestrationHost } from "./host.js";
import { JsonTaskStore } from "../store/json-task-store.js";

export function createOrchestrationHost(
  env: AppEnv,
  options: { orchestrator?: WorkflowOrchestrator } = {}
): OrchestrationHost {
  const orchestrator = options.orchestrator ?? new WorkflowOrchestrator(new JsonTaskStore(env.dataFilePath));
  const artifacts = new MarkdownArtifactService(env.projectRoot);

  return {
    env,
    orchestrator,
    artifacts,
    listTasks: () => orchestrator.listTasks(),
    getTask: (taskId) => orchestrator.getTask(taskId),
    async createTask(input) {
      return orchestrator.createTask(input);
    },
    approveOnly: (taskId, approverId) => orchestrator.approveTask(taskId, approverId),
    async savePlanRevision(taskId, actorId, planText) {
      let task = await orchestrator.applyPlanRevision(taskId, actorId, planText);
      const artifactUpdate = await artifacts.syncPlanArtifact(task);
      task = await orchestrator.updateArtifacts(task.taskId, actorId, artifactUpdate);
      return task;
    },
    rejectPlan: (taskId, actorId, reason) => orchestrator.rejectPlan(taskId, actorId, reason),
    saveImplementationSummary: (taskId, actorId, summary) => orchestrator.saveImplementationSummary(taskId, actorId, summary),
    recordReview: (taskId, actorId, decision, summary) => orchestrator.recordReview(taskId, actorId, decision, summary),
    updateArtifacts: (taskId, actorId, artifactUpdate) => orchestrator.updateArtifacts(taskId, actorId, artifactUpdate),
    async dispose() {}
  };
}
