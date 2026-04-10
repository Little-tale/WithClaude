import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import type { OrchestrationHost } from "../orchestrator/host.js";

export function createMcpServer(host: OrchestrationHost): McpServer {
  const server = new McpServer(
    {
      name: "agent-workflow-mcp",
      version: "0.1.0"
    },
    {
      capabilities: { logging: {} }
    }
  );

  server.registerTool(
    "create_task",
    {
      description: "Create a new draft workflow task.",
      inputSchema: z.object({
        title: z.string(),
        request: z.string(),
        requesterId: z.string().default("mcp-user"),
        requestedStage: z.enum(["request", "plan", "implement", "review"]).optional(),
        routingMode: z.enum(["sequential", "directed"]).optional(),
        workspaceRoot: z.string().optional()
      })
    },
    async ({ title, request, requesterId, requestedStage, routingMode, workspaceRoot }) => {
      const task = await host.createTask({
        title,
        request,
        requesterId,
        requestedStage,
        routingMode,
        source: "mcp",
        workspaceRoot: workspaceRoot ?? host.env.projectRoot
      });
      return {
        content: [{ type: "text", text: `Created draft task ${task.taskId}; status=${task.status}` }]
      };
    }
  );

  server.registerTool(
    "list_tasks",
    {
      description: "List current workflow tasks.",
      inputSchema: z.object({})
    },
    async () => {
      const tasks = await host.listTasks();
      return {
        content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }]
      };
    }
  );

  server.registerTool(
    "get_task_context",
    {
      description: "Get the current workflow task context.",
      inputSchema: z.object({ taskId: z.string() })
    },
    async ({ taskId }) => {
      const task = await host.getTask(taskId);
      if (!task) {
        return {
          content: [{ type: "text", text: `Task not found: ${taskId}` }]
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(task, null, 2) }]
      };
    }
  );

  server.registerTool(
    "get_approved_plan",
    {
      description: "Get the approved plan text for a task.",
      inputSchema: z.object({ taskId: z.string() })
    },
    async ({ taskId }) => {
      const task = await host.getTask(taskId);
      if (!task) {
        return {
          content: [{ type: "text", text: `Task not found: ${taskId}` }]
        };
      }

      return {
        content: [{ type: "text", text: task.planText }]
      };
    }
  );

  server.registerTool(
    "approve_task",
    {
      description: "Approve a task without automatically running implementation/review.",
      inputSchema: z.object({
        taskId: z.string(),
        approverId: z.string()
      })
    },
    async ({ taskId, approverId }) => {
      const task = await host.approveOnly(taskId, approverId);
      return {
        content: [{ type: "text", text: `Approved ${task.taskId}; status=${task.status}` }]
      };
    }
  );

  server.registerTool(
    "save_implementation_summary",
    {
      description: "Save an implementation summary and move the task into review.",
      inputSchema: z.object({
        taskId: z.string(),
        actorId: z.string(),
        summary: z.string()
      })
    },
    async ({ taskId, actorId, summary }) => {
      const task = await host.saveImplementationSummary(taskId, actorId, summary);
      return {
        content: [{ type: "text", text: `Saved summary for ${task.taskId}; status=${task.status}` }]
      };
    }
  );

  server.registerTool(
    "save_plan_revision",
    {
      description: "Save a plan revision before approval.",
      inputSchema: z.object({
        taskId: z.string(),
        actorId: z.string(),
        planText: z.string()
      })
    },
    async ({ taskId, actorId, planText }) => {
      const task = await host.savePlanRevision(taskId, actorId, planText);
      return {
        content: [{ type: "text", text: `Saved revision ${task.planRevision} for ${task.taskId}` }]
      };
    }
  );

  server.registerTool(
    "reject_plan",
    {
      description: "Reject a task plan before approval.",
      inputSchema: z.object({
        taskId: z.string(),
        actorId: z.string(),
        reason: z.string().optional()
      })
    },
    async ({ taskId, actorId, reason }) => {
      const task = await host.rejectPlan(taskId, actorId, reason);
      return {
        content: [{ type: "text", text: `Rejected ${task.taskId}; status=${task.status}` }]
      };
    }
  );

  server.registerTool(
    "record_review",
    {
      description: "Record a review decision for a task.",
      inputSchema: z.object({
        taskId: z.string(),
        actorId: z.string(),
        decision: z.enum(["approved", "rejected"]),
        summary: z.string()
      })
    },
    async ({ taskId, actorId, decision, summary }) => {
      const task = await host.recordReview(taskId, actorId, decision, summary);
      return {
        content: [{ type: "text", text: `Recorded ${decision} review for ${task.taskId}; status=${task.status}` }]
      };
    }
  );

  return server;
}

export async function startMcpServer(host: OrchestrationHost): Promise<void> {
  const server = createMcpServer(host);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("agent-workflow-mcp running on stdio");
}
