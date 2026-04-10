import express from "express";
import type { Request, Response } from "express";

import type { OrchestrationHost } from "../orchestrator/host.js";
import type { ReviewDecision } from "../types/task.js";

export function createApp(host: OrchestrationHost) {
  const app = express();

  app.use(express.json());

  app.get("/health", (_request: Request, response: Response) => {
    response.json({ ok: true });
  });

  app.get("/tasks", async (_request, response, next) => {
    try {
      response.json(await host.listTasks());
    } catch (error) {
      next(error);
    }
  });

  app.get("/tasks/:taskId", async (request, response, next) => {
    try {
      const task = await host.getTask(request.params.taskId);
      if (!task) {
        response.status(404).json({ message: "Task not found" });
        return;
      }

      response.json(task);
    } catch (error) {
      next(error);
    }
  });

  app.post("/tasks", async (request, response, next) => {
    try {
      const { title, request: taskRequest, requesterId, planText } = request.body as Record<string, string | undefined>;
        const task = await host.createTask({
          title: title ?? "Untitled task",
          request: taskRequest ?? "",
          requesterId: requesterId ?? "http-user",
          planText,
          source: "http"
        });

        response.status(201).json(task);
    } catch (error) {
      next(error);
    }
  });

  app.post("/tasks/:taskId/approve", async (request, response, next) => {
    try {
      const approverId = (request.body as Record<string, string | undefined>).approverId ?? "http-approver";
      const task = await host.approveOnly(request.params.taskId, approverId);
      response.json(task);
    } catch (error) {
      next(error);
    }
  });

  app.post("/tasks/:taskId/plan-revision", async (request, response, next) => {
    try {
      const body = request.body as Record<string, string | undefined>;
      response.json(
        await host.savePlanRevision(
          request.params.taskId,
          body.actorId ?? "planner",
          body.planText ?? body.feedback ?? ""
        )
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/tasks/:taskId/implementation", async (request, response, next) => {
    try {
      const body = request.body as Record<string, string | undefined>;
      response.json(
        await host.saveImplementationSummary(
          request.params.taskId,
          body.actorId ?? "claude-code",
          body.summary ?? ""
        )
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/tasks/:taskId/review", async (request, response, next) => {
    try {
      const body = request.body as Record<string, string | undefined>;
      const decision = (body.decision ?? "approved") as ReviewDecision;
      response.json(
        await host.recordReview(
          request.params.taskId,
          body.actorId ?? "oracle",
          decision,
          body.summary ?? ""
        )
      );
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    response.status(400).json({ message });
  });

  return app;
}
