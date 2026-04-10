import type { ReviewerAdapter } from "./types.js";

export const stubReviewer: ReviewerAdapter = {
  name: "oracle-stub",
  async runReview({ task }) {
    const lines = [
      `# Stub review for ${task.taskId}`,
      "",
      "> Oracle stub auto-approves the implementation. Replace with a real reviewer agent when wiring the production path.",
      "",
      "## Implementation summary reviewed",
      "",
      task.implementationSummary ?? "(missing implementation summary)"
    ];
    return { decision: "approved", summary: lines.join("\n") };
  }
};
