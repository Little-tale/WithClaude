import type { ImplementerAdapter } from "./types.js";

export const stubImplementer: ImplementerAdapter = {
  name: "claude-code-stub",
  async runImplementation({ task }) {
    const lines = [
      `# Stub implementation for ${task.taskId}`,
      "",
      "> Automated stub output. Replace with a real Claude Code invocation when wiring the production agent.",
      "",
      `## Approved plan (revision ${task.planRevision})`,
      "",
      task.planText,
      "",
      "## Workspace",
      `- root: ${task.workspaceRoot ?? "n/a"}`,
      `- source: ${task.source}`,
      `- requested stage: ${task.requestedStage}`
    ];
    return { summary: lines.join("\n") };
  }
};
