import path from "node:path";

import { tool, type Plugin } from "@opencode-ai/plugin";
import { runClaudeCliJson, type ClaudeCliConfig } from "../agents/claude-cli.js";
import {
  runGeminiCliJson,
  runGeminiDesignWithRollback,
  validateGeminiDesignSummary,
  validateGeminiReviewResult,
  type GeminiCliConfig
} from "../agents/gemini-cli.js";

import { loadEnv } from "../config/env.js";
import { createOrchestrationHost } from "../orchestrator/host-factory.js";
import type { WorkflowTask } from "../types/task.js";
import { createAutoUpdateHook } from "./auto-update-hook.js";
import { loadBundledSubagent } from "./bundled-subagent.js";
import { createRuntimeAssetSyncHook } from "./runtime-asset-sync.js";
import { loadWithClaudeConfig } from "./with-claude-config.js";

const schema = tool.schema;

function formatTaskList(tasks: WorkflowTask[]): string {
  if (tasks.length === 0) {
    return "No workflow tasks exist yet.";
  }

  return [
    "# Tasks",
    "",
    ...tasks.map((task) =>
      [
        `- taskId: ${task.taskId}`,
        `  title: ${task.title}`,
        `  status: ${task.status}`,
        `  revision: ${task.planRevision}`,
        `  stage: ${task.requestedStage}`,
        `  workspace: ${task.workspaceRoot ?? "(none)"}`
      ].join("\n")
    )
  ].join("\n");
}

function formatTaskContext(task: WorkflowTask | null): string {
  if (!task) {
    return "Task not found.";
  }

  return [
    `# Task ${task.taskId}`,
    "",
    `- title: ${task.title}`,
    `- status: ${task.status}`,
    `- requested stage: ${task.requestedStage}`,
    `- routing mode: ${task.routingMode}`,
    `- revision: ${task.planRevision}`,
    `- workspace: ${task.workspaceRoot ?? "(none)"}`,
    `- requester: ${task.requesterId}`,
    `- approvedBy: ${task.approvedBy ?? "(not approved)"}`,
    "",
    "## Request",
    task.request || "(empty)",
    "",
    "## Plan",
    task.planText || "(empty)",
    "",
    "## Implementation Summary",
    task.implementationSummary || "(empty)",
    "",
    "## Review Summary",
    task.reviewSummary || "(empty)",
    "",
    "## Artifacts",
    `- request: ${task.artifacts.requestMarkdownPath ?? "(missing)"}`,
    `- plan: ${task.artifacts.planMarkdownPath ?? "(missing)"}`,
    `- implementation: ${task.artifacts.implementationMarkdownPath ?? "(missing)"}`,
    `- review: ${task.artifacts.reviewMarkdownPath ?? "(missing)"}`
  ].join("\n");
}

function formatMutationResult(action: string, task: WorkflowTask): string {
  return [
    `# ${action}`,
    "",
    `- taskId: ${task.taskId}`,
    `- status: ${task.status}`,
    `- revision: ${task.planRevision}`,
    `- workspace: ${task.workspaceRoot ?? "(none)"}`
  ].join("\n");
}

function buildClaudePlanPrompt(task: WorkflowTask): string {
  return [
    "You are planClaude.",
    "Return only JSON matching the provided schema.",
    "Write or revise the plan for this workflow task.",
    "",
    `Task ID: ${task.taskId}`,
    `Status: ${task.status}`,
    `Revision: ${task.planRevision}`,
    "",
    "## Request",
    task.request,
    "",
    "## Existing Plan",
    task.planText || "(empty)"
  ].join("\n");
}

function buildClaudeImplementPrompt(task: WorkflowTask): string {
  return [
    "You are implClaude.",
    "Return only JSON matching the provided schema.",
    "Implement the approved plan in the current workspace.",
    "",
    `Task ID: ${task.taskId}`,
    `Workspace: ${task.workspaceRoot ?? "(none)"}`,
    `Revision: ${task.planRevision}`,
    "",
    "## Request",
    task.request,
    "",
    "## Approved Plan",
    task.planText
  ].join("\n");
}

function buildClaudeReviewPrompt(task: WorkflowTask): string {
  return [
    "You are reviewClaude.",
    "Return only JSON matching the provided schema.",
    "Review the implementation against the approved plan.",
    "",
    `Task ID: ${task.taskId}`,
    `Revision: ${task.planRevision}`,
    "",
    "## Request",
    task.request,
    "",
    "## Approved Plan",
    task.planText,
    "",
    "## Implementation Summary",
    task.implementationSummary || "(empty)"
  ].join("\n");
}

function buildGeminiDesignPrompt(task: WorkflowTask): string {
  return [
    "You are designGemini.",
    "Return only JSON matching the provided schema.",
    "Implement only the frontend styling and component-structure parts of the approved plan in the current workspace.",
    "Do not perform unrelated business-logic work.",
    "If the approved plan includes non-UI work, summarize only the UI-related implementation you completed.",
    "On success, return JSON with a single `summary` field.",
    "On failure, do not fabricate success output.",
    "",
    `Task ID: ${task.taskId}`,
    `Workspace: ${task.workspaceRoot ?? "(none)"}`,
    `Revision: ${task.planRevision}`,
    "",
    "## Request",
    task.request,
    "",
    "## Approved Plan",
    task.planText
  ].join("\n");
}

function buildGeminiReviewPrompt(task: WorkflowTask): string {
  return [
    "You are reviewGemini.",
    "Return only JSON matching the provided schema.",
    "Review the implementation against the approved plan.",
    "Return a strict verdict using `approved` or `rejected`.",
    "",
    `Task ID: ${task.taskId}`,
    `Revision: ${task.planRevision}`,
    "",
    "## Request",
    task.request,
    "",
    "## Approved Plan",
    task.planText,
    "",
    "## Implementation Summary",
    task.implementationSummary || "(empty)"
  ].join("\n");
}

function resolvePluginEnv(directory: string, worktree: string) {
  const env = loadEnv();
  const projectRoot = worktree || directory;
  const dataDir = path.isAbsolute(env.DATA_DIR) ? env.DATA_DIR : path.resolve(projectRoot, env.DATA_DIR);
  return {
    ...env,
    projectRoot,
    dataFilePath: path.resolve(dataDir, "tasks.json")
  };
}

const AgentWorkflowPlugin: Plugin = async (input) => {
  const env = resolvePluginEnv(input.directory, input.worktree);
  const host = createOrchestrationHost(env);
  let withClaudeConfig = await loadWithClaudeConfig(env.projectRoot) as {
    agent?: Record<string, { description?: string; mode?: "subagent" | "primary" | "all"; hidden?: boolean; model?: string; prompt?: string; tools?: Record<string, boolean> }>;
    claudeCli?: ClaudeCliConfig;
    geminiCli?: GeminiCliConfig;
  };
  const subagents = await Promise.all([
    loadBundledSubagent("designGemini"),
    loadBundledSubagent("implClaude"),
    loadBundledSubagent("planClaude"),
    loadBundledSubagent("reviewClaude"),
    loadBundledSubagent("reviewGemini")
  ]);
  const assetSyncHook = createRuntimeAssetSyncHook(input);
  const autoUpdateHook = createAutoUpdateHook(input);

  return {
    event: async ({ event }) => {
      await assetSyncHook.event({ event });
      withClaudeConfig = await loadWithClaudeConfig(env.projectRoot) as typeof withClaudeConfig;
      await autoUpdateHook.event({ event });
    },
    config: async (config) => {
      const existing = config.agent ?? {};
      config.agent = { ...existing };
      for (const agent of subagents) {
        const override = withClaudeConfig.agent?.[agent.name] ?? {};
        config.agent[agent.name] = {
          ...(existing[agent.name] ?? {}),
          description: override.description ?? agent.description,
          mode: override.mode ?? agent.mode,
          ...(typeof override.hidden === "boolean" ? { hidden: override.hidden } : {}),
          ...(override.model ? { model: override.model } : {}),
          prompt: override.prompt ?? agent.prompt,
          ...((override.tools ?? agent.tools) ? { tools: override.tools ?? agent.tools } : {})
        };
      }
    },
    tool: {
      create_task: tool({
        description: "Create a new workflow task.",
        args: {
          title: schema.string(),
          request: schema.string(),
          requesterId: schema.string().optional(),
          requestedStage: schema.enum(["request", "plan", "implement", "review"]).optional(),
          routingMode: schema.enum(["sequential", "directed"]).optional()
        },
        async execute({ title, request, requesterId, requestedStage, routingMode }) {
          const task = await host.createTask({
            title,
            request,
            requesterId: requesterId ?? "opencode-user",
            requestedStage,
            routingMode,
            source: "plugin",
            workspaceRoot: env.projectRoot
          });
          return `${formatMutationResult("Created Task", task)}\n\nThis creates a draft task only. Use get_task_context before planning, or save_plan_revision to persist an authored plan.`;
        }
      }),
      list_tasks: tool({
        description: "List current workflow tasks.",
        args: {},
        async execute() {
          const tasks = await host.listTasks();
          return formatTaskList(tasks);
        }
      }),
      get_task_context: tool({
        description: "Get the current workflow task context.",
        args: { taskId: schema.string() },
        async execute({ taskId }) {
          const task = await host.getTask(taskId);
          return task ? formatTaskContext(task) : `Task not found: ${taskId}`;
        }
      }),
      get_approved_plan: tool({
        description: "Get the approved plan text for a task.",
        args: { taskId: schema.string() },
        async execute({ taskId }) {
          const task = await host.getTask(taskId);
          return task ? task.planText || "(empty)" : `Task not found: ${taskId}`;
        }
      }),
      save_implementation_summary: tool({
        description: "Save an implementation summary and move the task into review.",
        args: {
          taskId: schema.string(),
          actorId: schema.string(),
          summary: schema.string()
        },
        async execute({ taskId, actorId, summary }) {
          const task = await host.saveImplementationSummary(taskId, actorId, summary);
          return formatMutationResult("Saved Implementation Summary", task);
        }
      }),
      save_plan_revision: tool({
        description: "Save a plan revision before approval.",
        args: {
          taskId: schema.string(),
          actorId: schema.string(),
          planText: schema.string()
        },
        async execute({ taskId, actorId, planText }) {
          const task = await host.savePlanRevision(taskId, actorId, planText);
          return `${formatMutationResult("Saved Plan Revision", task)}\n\nThe task is now ready for explicit approval.`;
        }
      }),
      run_claude_plan: tool({
        description: "Use Claude CLI to author a plan and save it for a task.",
        args: {
          taskId: schema.string(),
          actorId: schema.string()
        },
        async execute({ taskId, actorId }) {
          const task = await host.getTask(taskId);
          if (!task) {
            return `Task not found: ${taskId}`;
          }
          const result = await runClaudeCliJson<{ planText: string }>({
            config: withClaudeConfig.claudeCli ?? {},
            role: "planClaude",
            prompt: buildClaudePlanPrompt(task),
            cwd: task.workspaceRoot ?? env.projectRoot,
            schema: {
              type: "object",
              properties: { planText: { type: "string" } },
              required: ["planText"]
            }
          });
          const saved = await host.savePlanRevision(taskId, actorId, result.planText);
          return formatMutationResult("Claude Planned Task", saved);
        }
      }),
      approve_task: tool({
        description: "Approve a task without automatically running implementation or review.",
        args: {
          taskId: schema.string(),
          approverId: schema.string()
        },
        async execute({ taskId, approverId }) {
          const task = await host.approveOnly(taskId, approverId);
          return `${formatMutationResult("Approved Task", task)}\n\nUse @implClaude or @designGemini next when you are ready to execute the approved plan.`;
        }
      }),
      reject_plan: tool({
        description: "Reject a task plan before approval.",
        args: {
          taskId: schema.string(),
          actorId: schema.string(),
          reason: schema.string().optional()
        },
        async execute({ taskId, actorId, reason }) {
          const task = await host.rejectPlan(taskId, actorId, reason ?? "rejected in OpenCode");
          return formatMutationResult("Rejected Task", task);
        }
      }),
      record_review: tool({
        description: "Record a review decision for a task.",
        args: {
          taskId: schema.string(),
          actorId: schema.string(),
          decision: schema.enum(["approved", "rejected"]),
          summary: schema.string()
        },
        async execute({ taskId, actorId, decision, summary }) {
          const task = await host.recordReview(taskId, actorId, decision, summary);
          return `${formatMutationResult(`Recorded ${decision} Review`, task)}\n\nReview summary saved.`;
        }
      }),
      run_claude_implementation: tool({
        description: "Use Claude CLI to implement an approved plan and save the implementation summary.",
        args: {
          taskId: schema.string(),
          actorId: schema.string()
        },
        async execute({ taskId, actorId }) {
          const task = await host.getTask(taskId);
          if (!task) {
            return `Task not found: ${taskId}`;
          }
          const result = await runClaudeCliJson<{ summary: string }>({
            config: withClaudeConfig.claudeCli ?? {},
            role: "implClaude",
            prompt: buildClaudeImplementPrompt(task),
            cwd: task.workspaceRoot ?? env.projectRoot,
            schema: {
              type: "object",
              properties: { summary: { type: "string" } },
              required: ["summary"]
            },
            templates: {
              workspaceRoot: task.workspaceRoot ?? env.projectRoot
            }
          });
          const saved = await host.saveImplementationSummary(taskId, actorId, result.summary);
          return formatMutationResult("Claude Implemented Task", saved);
        }
      }),
      run_claude_review: tool({
        description: "Use Claude CLI to review an implementation and record the review result.",
        args: {
          taskId: schema.string(),
          actorId: schema.string()
        },
        async execute({ taskId, actorId }) {
          const task = await host.getTask(taskId);
          if (!task) {
            return `Task not found: ${taskId}`;
          }
          const result = await runClaudeCliJson<{ decision: "approved" | "rejected"; summary: string }>({
            config: withClaudeConfig.claudeCli ?? {},
            role: "reviewClaude",
            prompt: buildClaudeReviewPrompt(task),
            cwd: task.workspaceRoot ?? env.projectRoot,
            schema: {
              type: "object",
              properties: {
                decision: { type: "string", enum: ["approved", "rejected"] },
                summary: { type: "string" }
              },
              required: ["decision", "summary"]
            }
          });
          const saved = await host.recordReview(taskId, actorId, result.decision, result.summary);
          return formatMutationResult("Claude Reviewed Task", saved);
        }
      }),
      run_gemini_design: tool({
        description: "Use Gemini CLI to implement frontend styling and component structure for an approved plan and save the implementation summary.",
        args: {
          taskId: schema.string(),
          actorId: schema.string()
        },
        async execute({ taskId, actorId }) {
          const task = await host.getTask(taskId);
          if (!task) {
            return `Task not found: ${taskId}`;
          }
          const result = await runGeminiDesignWithRollback<{ summary: string }>({
            config: withClaudeConfig.geminiCli ?? {},
            prompt: buildGeminiDesignPrompt(task),
            cwd: task.workspaceRoot ?? env.projectRoot,
            templates: {
              workspaceRoot: task.workspaceRoot ?? env.projectRoot
            },
            validate: validateGeminiDesignSummary
          });
          const saved = await host.saveImplementationSummary(taskId, actorId, result.summary);
          return formatMutationResult("Gemini Designed Task", saved);
        }
      }),
      run_gemini_review: tool({
        description: "Use Gemini CLI to review an implementation and record the review result.",
        args: {
          taskId: schema.string(),
          actorId: schema.string()
        },
        async execute({ taskId, actorId }) {
          const task = await host.getTask(taskId);
          if (!task) {
            return `Task not found: ${taskId}`;
          }
          const result = await runGeminiCliJson<{ decision: "approved" | "rejected"; summary: string }>({
            config: withClaudeConfig.geminiCli ?? {},
            role: "reviewGemini",
            prompt: buildGeminiReviewPrompt(task),
            cwd: task.workspaceRoot ?? env.projectRoot,
            validate: validateGeminiReviewResult
          });
          const saved = await host.recordReview(taskId, actorId, result.decision, result.summary);
          return formatMutationResult("Gemini Reviewed Task", saved);
        }
      })
    },
    "session.idle": async () => {
      await host.dispose();
    }
  } as Awaited<ReturnType<Plugin>> & { "session.idle": () => Promise<void> };
};

export default AgentWorkflowPlugin;
