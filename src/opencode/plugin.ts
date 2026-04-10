import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tool, type Plugin } from "@opencode-ai/plugin";
import { runClaudeCliJson, type ClaudeCliConfig } from "../agents/claude-cli.js";

import { loadEnv } from "../config/env.js";
import type { OrchestrationHost } from "../orchestrator/host.js";
import { createOrchestrationHost } from "../orchestrator/host-factory.js";
import type { WorkflowTask } from "../types/task.js";

const schema = tool.schema;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

type LoadedSubagent = {
  name: string;
  description: string;
  mode: "subagent" | "primary" | "all";
  prompt: string;
  tools?: Record<string, boolean>;
};

type WithClaudeAgentConfig = {
  description?: string;
  mode?: "subagent" | "primary" | "all";
  hidden?: boolean;
  model?: string;
  prompt?: string;
  tools?: Record<string, boolean>;
};

type WithClaudeConfig = {
  agent?: Record<string, WithClaudeAgentConfig>;
  claudeCli?: ClaudeCliConfig;
};

function defaultOpenCodeConfigDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  return xdgConfigHome
    ? path.resolve(xdgConfigHome, "opencode")
    : path.join(os.homedir(), ".config", "opencode");
}

async function readWithClaudeConfigFile(filePath: string): Promise<WithClaudeConfig> {
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = parseJsoncObject(content) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as WithClaudeConfig) : {};
  } catch {
    return {};
  }
}

function mergeWithClaudeConfig(base: WithClaudeConfig, override: WithClaudeConfig): WithClaudeConfig {
  const mergedAgent = base.agent || override.agent
    ? Object.fromEntries(
        Array.from(new Set([...Object.keys(base.agent ?? {}), ...Object.keys(override.agent ?? {})])).map((agentName) => [
            agentName,
            {
              ...(base.agent?.[agentName] ?? {}),
              ...(override.agent?.[agentName] ?? {})
            }
          ])
      )
    : undefined;

  const mergedClaudeCli = base.claudeCli || override.claudeCli
    ? {
      ...(base.claudeCli ?? {}),
      ...(override.claudeCli ?? {}),
      roles: Object.fromEntries(
        Array.from(
          new Set([
            ...Object.keys(base.claudeCli?.roles ?? {}),
            ...Object.keys(override.claudeCli?.roles ?? {})
          ])
        ).map((roleName) => [
            roleName,
            {
              ...(base.claudeCli?.roles?.[roleName as keyof NonNullable<typeof base.claudeCli.roles>] ?? {}),
              ...(override.claudeCli?.roles?.[roleName as keyof NonNullable<typeof override.claudeCli.roles>] ?? {})
            }
          ])
      )
    }
    : undefined;

  return {
    ...(base ?? {}),
    ...(override ?? {}),
    ...(mergedAgent ? { agent: mergedAgent } : {}),
    ...(mergedClaudeCli ? { claudeCli: mergedClaudeCli } : {})
  };
}

async function loadBundledSubagent(name: string): Promise<LoadedSubagent> {
  const filePath = path.join(packageRoot, ".opencode", "agents", `${name}.md`);
  const content = await readFile(filePath, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid subagent manifest: ${filePath}`);
  }

  const frontmatter = match[1];
  const prompt = match[2].trim();
  let description = "";
  let mode: LoadedSubagent["mode"] = "subagent";
  const tools: Record<string, boolean> = {};
  let inTools = false;
  let currentToolIndent = -1;

  for (const rawLine of frontmatter.split("\n")) {
    const line = rawLine.trim();
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    if (line.startsWith("description:")) {
      description = line.slice("description:".length).trim();
      inTools = false;
      currentToolIndent = -1;
      continue;
    }
    if (line.startsWith("mode:")) {
      const parsed = line.slice("mode:".length).trim();
      if (parsed === "subagent" || parsed === "primary" || parsed === "all") {
        mode = parsed;
      }
      inTools = false;
      currentToolIndent = -1;
      continue;
    }
    if (line === "tools:") {
      inTools = true;
      currentToolIndent = -1;
      continue;
    }
    if (inTools && line.includes(":")) {
      const [toolName, rawValue] = line.split(/:\s*/, 2);
      if (toolName) {
        tools[toolName.trim()] = rawValue ? rawValue.trim() === "true" : true;
        currentToolIndent = indent;
      }
      continue;
    }
    if (inTools && line.length > 0 && currentToolIndent >= 0 && indent > currentToolIndent) {
      continue;
    }
    inTools = false;
    currentToolIndent = -1;
  }

  return {
    name,
    description,
    mode,
    prompt,
    tools: Object.keys(tools).length > 0 ? tools : undefined
  };
}

async function loadWithClaudeConfig(projectRoot: string): Promise<WithClaudeConfig> {
  const globalFilePath = path.join(defaultOpenCodeConfigDir(), ".opencode", "opencode-with-claude.jsonc");
  const projectFilePath = path.join(projectRoot, ".opencode", "opencode-with-claude.jsonc");
  const [globalConfig, projectConfig] = await Promise.all([
    readWithClaudeConfigFile(globalFilePath),
    readWithClaudeConfigFile(projectFilePath)
  ]);

  return mergeWithClaudeConfig(globalConfig, projectConfig);
}

function parseJsoncObject(content: string): unknown {
  const withoutBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(withoutLineComments);
}

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
  const withClaudeConfig = await loadWithClaudeConfig(env.projectRoot);
  const subagents = await Promise.all([
    loadBundledSubagent("implClaude"),
    loadBundledSubagent("planClaude"),
    loadBundledSubagent("reviewClaude")
  ]);

  return {
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
          return `${formatMutationResult("Approved Task", task)}\n\nUse run_claude_implementation next when you are ready to execute the approved plan.`;
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
      })
    },
    "session.idle": async () => {
      await host.dispose();
    }
  } as Awaited<ReturnType<Plugin>> & { "session.idle": () => Promise<void> };
};

export default AgentWorkflowPlugin;
