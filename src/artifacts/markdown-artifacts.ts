import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TaskArtifacts, WorkflowTask } from "../types/task.js";

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function extractPreviewLines(text: string, maxLines = 5): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map((line) =>
      line
        .replace(/^#+\s*/, "")
        .replace(/^[-*+]\s*/, "")
        .replace(/^>\s*/, "")
        .replace(/^\d+\.\s*/, "")
        .trim()
    )
    .filter(Boolean);
}

export type MarkdownArtifactSummary = {
  artifactPath: string;
  previewLines: string[];
};

export class MarkdownArtifactService {
  constructor(private readonly fallbackRoot: string) {}

  requestArtifactPath(taskId: string): string {
    return normalizePath(path.join(".omd", "plan", taskId, "request.md"));
  }

  planArtifactPath(taskId: string, planRevision: number, baseDir = path.join(".omd", "plan", taskId)): string {
    return normalizePath(path.join(baseDir, `plan-v${planRevision}.md`));
  }

  implementationArtifactPath(taskId: string): string {
    return normalizePath(path.join(".omd", "plan", taskId, "implementation-summary.md"));
  }

  reviewArtifactPath(taskId: string): string {
    return normalizePath(path.join(".omd", "plan", taskId, "review-summary.md"));
  }

  async writeRequestArtifact(task: WorkflowTask): Promise<MarkdownArtifactSummary> {
    const relativePath = this.requestArtifactPath(task.taskId);
    const content = [
      `# Request · ${task.taskId}`,
      "",
      `- title: ${task.title}`,
      `- source: ${task.source}`,
      `- requested stage: ${task.requestedStage}`,
      `- routing: ${task.routingMode}`,
      `- workspace: ${task.workspaceRoot ?? "n/a"}`,
      "",
      "## Original request",
      "",
      task.request
    ].join("\n");

    await this.writeArtifact(task, relativePath, content);
    return {
      artifactPath: relativePath,
      previewLines: extractPreviewLines(task.request)
    };
  }

  async writePlanArtifact(task: WorkflowTask): Promise<MarkdownArtifactSummary> {
    const relativePath = await this.resolvePlanArtifactPath(task);
    const content = [
      `# Plan · ${task.taskId}`,
      "",
      `- revision: ${task.planRevision}`,
      `- status: ${task.status}`,
      `- requested stage: ${task.requestedStage}`,
      `- routing: ${task.routingMode}`,
      `- workspace: ${task.workspaceRoot ?? "n/a"}`,
      "",
      task.planText
    ].join("\n");

    await this.writeArtifact(task, relativePath, content);
    return {
      artifactPath: relativePath,
      previewLines: extractPreviewLines(task.planText)
    };
  }

  async writeImplementationArtifact(task: WorkflowTask): Promise<MarkdownArtifactSummary> {
    const relativePath = this.implementationArtifactPath(task.taskId);
    const body = task.implementationSummary ?? "(no implementation summary)";
    const content = [
      `# Implementation Summary · ${task.taskId}`,
      "",
      `- status: ${task.status}`,
      `- workspace: ${task.workspaceRoot ?? "n/a"}`,
      "",
      body
    ].join("\n");

    await this.writeArtifact(task, relativePath, content);
    return {
      artifactPath: relativePath,
      previewLines: extractPreviewLines(body)
    };
  }

  async writeReviewArtifact(task: WorkflowTask): Promise<MarkdownArtifactSummary> {
    const relativePath = this.reviewArtifactPath(task.taskId);
    const body = task.reviewSummary ?? "(no review summary)";
    const content = [
      `# Review Summary · ${task.taskId}`,
      "",
      `- status: ${task.status}`,
      "",
      body
    ].join("\n");

    await this.writeArtifact(task, relativePath, content);
    return {
      artifactPath: relativePath,
      previewLines: extractPreviewLines(body)
    };
  }

  async syncRequestArtifact(task: WorkflowTask): Promise<Partial<TaskArtifacts>> {
    const request = await this.writeRequestArtifact(task);
    return { requestMarkdownPath: request.artifactPath };
  }

  async syncPlanArtifact(task: WorkflowTask): Promise<Partial<TaskArtifacts>> {
    const plan = await this.writePlanArtifact(task);
    return { planMarkdownPath: plan.artifactPath };
  }

  async syncImplementationArtifact(task: WorkflowTask): Promise<Partial<TaskArtifacts>> {
    const implementation = await this.writeImplementationArtifact(task);
    return { implementationMarkdownPath: implementation.artifactPath };
  }

  async syncReviewArtifact(task: WorkflowTask): Promise<Partial<TaskArtifacts>> {
    const review = await this.writeReviewArtifact(task);
    return { reviewMarkdownPath: review.artifactPath };
  }

  private async resolvePlanArtifactPath(task: WorkflowTask): Promise<string> {
    const root = task.workspaceRoot ?? this.fallbackRoot;
    const sisyphusPlansDir = path.resolve(root, ".sisyphus", "plans");

    try {
      await access(sisyphusPlansDir);
      return this.planArtifactPath(task.taskId, task.planRevision, ".sisyphus/plans");
    } catch {
      return this.planArtifactPath(task.taskId, task.planRevision, "plans");
    }
  }

  private async writeArtifact(task: WorkflowTask, relativePath: string, content: string): Promise<void> {
    const root = task.workspaceRoot ?? this.fallbackRoot;
    const absolutePath = path.resolve(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
}
