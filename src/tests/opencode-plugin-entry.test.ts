import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import plugin from "../plugin-entry.js";

const originalEnv = { ...process.env };

test("plugin entry exports a default OpenCode plugin with orchestration tools", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-entry-"));
  await mkdir(path.join(projectRoot, ".opencode"), { recursive: true });
  await writeFile(
    path.join(projectRoot, ".opencode", "opencode-with-claude.jsonc"),
    `{
  "claudeCli": {
    "command": "claude",
    "commonArgs": ["-p", "--output-format", "json"],
    "roles": {
      "planClaude": { "model": "sonnet", "args": ["--permission-mode", "plan"] },
      "implClaude": { "model": "sonnet", "args": ["--permission-mode", "acceptEdits", "--add-dir", "{{workspaceRoot}}"] },
      "reviewClaude": { "model": "sonnet", "args": ["--permission-mode", "plan"] }
    }
  }
}
`,
    "utf8"
  );
  process.env.PLANNER_TRANSPORT = "command";
  process.env.PLANNER_COMMAND = process.execPath;
  process.env.PLANNER_ARGS = JSON.stringify(["-e", 'process.stdout.write(JSON.stringify({ planText: "unused" }))']);
  delete process.env.IMPLEMENTER_COMMAND;
  delete process.env.IMPLEMENTER_ARGS;
  process.env.DATA_DIR = "./data";

  try {
    const hooks = await plugin({
      directory: projectRoot,
      worktree: projectRoot,
      client: {} as never,
      project: {} as never,
      serverUrl: new URL("http://127.0.0.1"),
      $: {} as never
    });

    assert.ok(hooks.tool);
    assert.deepEqual(Object.keys(hooks.tool ?? {}).sort(), [
      "approve_task",
      "create_task",
      "get_approved_plan",
      "get_task_context",
      "list_tasks",
      "record_review",
      "reject_plan",
      "run_claude_implementation",
      "run_claude_plan",
      "run_claude_review",
      "save_implementation_summary",
      "save_plan_revision"
    ]);
    assert.equal(typeof hooks.config, "function");
    const config = {} as { agent?: Record<string, { mode?: string; description?: string; prompt?: string; model?: string; tools?: Record<string, boolean> }> };
    await hooks.config?.(config as never);
    assert.deepEqual(Object.keys(config.agent ?? {}).sort(), ["implClaude", "planClaude", "reviewClaude"]);
    assert.equal(config.agent?.implClaude?.mode, "subagent");
    assert.match(config.agent?.implClaude?.description ?? "", /implementation executor/);
    assert.match(config.agent?.planClaude?.prompt ?? "", /planning assistant/);
    assert.deepEqual(Object.keys(config.agent?.implClaude?.tools ?? {}).sort(), [
      "get_approved_plan",
      "get_task_context",
      "list_tasks",
      "run_claude_implementation"
    ]);
    assert.equal(typeof (hooks as { [key: string]: unknown })["session.idle"], "function");
  } finally {
    process.env = { ...originalEnv };
  }
});

test("plugin tools return structured workflow-oriented text instead of raw json blobs", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-tools-"));
  await mkdir(path.join(projectRoot, ".opencode"), { recursive: true });
  await writeFile(
    path.join(projectRoot, ".opencode", "opencode-with-claude.jsonc"),
    `{
  "claudeCli": {
    "command": "claude",
    "commonArgs": ["-p", "--output-format", "json"],
    "roles": {
      "planClaude": { "model": "sonnet", "args": ["--permission-mode", "plan"] },
      "implClaude": { "model": "sonnet", "args": ["--permission-mode", "acceptEdits", "--add-dir", "{{workspaceRoot}}"] },
      "reviewClaude": { "model": "sonnet", "args": ["--permission-mode", "plan"] }
    }
  }
}
`,
    "utf8"
  );
  process.env.PLANNER_TRANSPORT = "command";
  process.env.PLANNER_COMMAND = process.execPath;
  process.env.PLANNER_ARGS = JSON.stringify(["-e", 'process.stdout.write(JSON.stringify({ planText: "unused" }))']);
  delete process.env.IMPLEMENTER_COMMAND;
  delete process.env.IMPLEMENTER_ARGS;
  process.env.DATA_DIR = "./data";

  try {
    const hooks = await plugin({
      directory: projectRoot,
      worktree: projectRoot,
      client: {} as never,
      project: {} as never,
      serverUrl: new URL("http://127.0.0.1"),
      $: {} as never
    });

    const createTask = (hooks.tool as Record<string, { execute?: (args: Record<string, unknown>, context?: unknown) => Promise<string> }>).create_task;
    const listTasks = (hooks.tool as Record<string, { execute?: (args: Record<string, unknown>, context?: unknown) => Promise<string> }>).list_tasks;
    const getTaskContext = (hooks.tool as Record<string, { execute?: (args: Record<string, unknown>, context?: unknown) => Promise<string> }>).get_task_context;

    assert.equal(typeof createTask?.execute, "function");
    assert.equal(typeof listTasks?.execute, "function");
    assert.equal(typeof getTaskContext?.execute, "function");

    const created = await createTask!.execute!({
      title: "Plugin task",
      request: "Create a task from plugin",
      requesterId: "plugin-user"
    });
    assert.match(created, /^# Created Task/m);
    assert.match(created, /- status: draft_plan/);
    assert.match(created, /This creates a draft task only/);

    const taskIdMatch = created.match(/- taskId: (task-[a-z0-9-]+)/i);
    assert.ok(taskIdMatch);
    const taskId = taskIdMatch[1]!;

    const listed = await listTasks!.execute!({});
    assert.match(listed, /^# Tasks/m);
    assert.match(listed, new RegExp(taskId));
    assert.match(listed, /stage: request/);

    const context = await getTaskContext!.execute!({ taskId });
    assert.match(context, new RegExp(`^# Task ${taskId}`, "m"));
    assert.match(context, /## Request/);
    assert.match(context, /## Plan/);
    assert.match(context, /## Artifacts/);
    assert.match(context, /workspace:/);

    const savePlanRevision = (hooks.tool as Record<string, { execute?: (args: Record<string, unknown>, context?: unknown) => Promise<string> }>).save_plan_revision;
    const approveTask = (hooks.tool as Record<string, { execute?: (args: Record<string, unknown>, context?: unknown) => Promise<string> }>).approve_task;
    assert.equal(typeof savePlanRevision?.execute, "function");
    assert.equal(typeof approveTask?.execute, "function");
    const revised = await savePlanRevision!.execute!({
      taskId,
      actorId: "planClaude",
      planText: "# Authored Plan\n\n- first step"
    });
    assert.match(revised, /^# Saved Plan Revision/m);
    assert.match(revised, /- status: awaiting_approval/);
    assert.match(revised, /ready for explicit approval/);

    const revisedContext = await getTaskContext!.execute!({ taskId });
    assert.match(revisedContext, /# Authored Plan/);
    assert.match(revisedContext, /- status: awaiting_approval/);

    const approved = await approveTask!.execute!({
      taskId,
      approverId: "planClaude"
    });
    assert.match(approved, /^# Approved Task/m);
    assert.match(approved, /Use run_claude_implementation next/);
  } finally {
    process.env = { ...originalEnv };
  }
});
