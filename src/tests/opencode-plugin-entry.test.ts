import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import plugin from "../plugin-entry.js";

const originalEnv = { ...process.env };

type PluginToolMap = Record<string, { execute?: (args: Record<string, unknown>, context?: unknown) => Promise<string> }>;

async function waitFor(assertion: () => void | Promise<void>, attempts = 20): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

async function writeWithClaudeConfig(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function withClaudeConfigJson(overrides: {
  command?: string;
  commonArgs?: string[];
  defaultModel?: string | null;
  planModel?: string | null;
  implModel?: string | null;
  reviewModel?: string | null;
  agentPlanModel?: string;
} = {}): string {
  const {
    command = "claude",
    commonArgs = ["-p", "--output-format", "json"],
    agentPlanModel
  } = overrides;

  const readModelOverride = (key: "defaultModel" | "planModel" | "implModel" | "reviewModel", fallback?: string): string | undefined => {
    if (!(key in overrides)) {
      return fallback;
    }
    return overrides[key] ?? undefined;
  };

  const defaultModel = readModelOverride("defaultModel");
  const planModel = readModelOverride("planModel", defaultModel ? undefined : "sonnet");
  const implModel = readModelOverride("implModel", defaultModel ? undefined : "sonnet");
  const reviewModel = readModelOverride("reviewModel", defaultModel ? undefined : "sonnet");

  const roleConfig = (model: string | undefined, args: string[]) => ({
    ...(model ? { model } : {}),
    args
  });

  return `${JSON.stringify(
    {
      ...(agentPlanModel ? { agent: { planClaude: { model: agentPlanModel } } } : {}),
      claudeCli: {
        command,
        commonArgs,
        ...(defaultModel ? { defaultModel } : {}),
        roles: {
          planClaude: roleConfig(planModel, ["--permission-mode", "plan"]),
          implClaude: roleConfig(implModel, ["--permission-mode", "acceptEdits", "--add-dir", "{{workspaceRoot}}"]),
          reviewClaude: roleConfig(reviewModel, ["--permission-mode", "plan"])
        }
      }
    },
    null,
    2
  )}
`;
}

test("plugin entry exports a default OpenCode plugin with orchestration tools", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-entry-"));
  await writeWithClaudeConfig(path.join(projectRoot, ".opencode", "opencode-with-claude.jsonc"), withClaudeConfigJson());
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
  await writeWithClaudeConfig(path.join(projectRoot, ".opencode", "opencode-with-claude.jsonc"), withClaudeConfigJson());
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

test("run_claude_plan persists plan markdown artifacts without explicit markdown prompting", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-plan-artifact-"));
  const claudeScript = path.join(projectRoot, "fake-claude-plan-artifact.js");
  await writeFile(
    claudeScript,
    [
      "#!/usr/bin/env node",
      'process.stdout.write(JSON.stringify({ planText: "# Generated Plan\\n\\n- save by default" }));'
    ].join("\n"),
    "utf8"
  );
  await writeWithClaudeConfig(
    path.join(projectRoot, ".opencode", "opencode-with-claude.jsonc"),
    withClaudeConfigJson({ command: process.execPath, commonArgs: [claudeScript] })
  );
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

    const createTask = (hooks.tool as PluginToolMap).create_task;
    const runClaudePlan = (hooks.tool as PluginToolMap).run_claude_plan;
    const getTaskContext = (hooks.tool as PluginToolMap).get_task_context;

    assert.equal(typeof createTask?.execute, "function");
    assert.equal(typeof runClaudePlan?.execute, "function");
    assert.equal(typeof getTaskContext?.execute, "function");

    const created = await createTask!.execute!({
      title: "Artifact persistence task",
      request: "Create and save a plan by default",
      requesterId: "plugin-user"
    });
    const taskId = created.match(/- taskId: (task-[a-z0-9-]+)/i)?.[1];
    assert.ok(taskId);

    await runClaudePlan!.execute!({ taskId, actorId: "planClaude" });

    const context = await getTaskContext!.execute!({ taskId });
    const planPathMatch = context.match(/- plan: (.+)/);
    assert.ok(planPathMatch);
    assert.equal(planPathMatch[1], "plans/plan-v1.md");

    const planBody = await readFile(path.join(projectRoot, "plans", "plan-v1.md"), "utf8");
    assert.match(planBody, /# Plan ·/);
    assert.match(planBody, /# Generated Plan/);
    assert.match(planBody, /save by default/);
  } finally {
    process.env = { ...originalEnv };
  }
});

test("plugin falls back to global with-claude config and lets project config override it", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-global-"));
  const xdgConfigHome = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-xdg-"));
  const claudeScript = path.join(projectRoot, "fake-claude.js");

  await writeFile(
    claudeScript,
    [
      "#!/usr/bin/env node",
      'process.stdout.write(JSON.stringify({ planText: process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : "missing-model" }));'
    ].join("\n"),
    "utf8"
  );

  await writeWithClaudeConfig(
    path.join(xdgConfigHome, "opencode", ".opencode", "opencode-with-claude.jsonc"),
    withClaudeConfigJson({
      command: process.execPath,
      commonArgs: [claudeScript],
      planModel: "opus",
      agentPlanModel: "with-claude/opus"
    })
  );

  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  process.env.DATA_DIR = "./data";

  try {
    let hooks = await plugin({
      directory: projectRoot,
      worktree: projectRoot,
      client: {} as never,
      project: {} as never,
      serverUrl: new URL("http://127.0.0.1"),
      $: {} as never
    });

    const config = {} as { agent?: Record<string, { model?: string }> };
    await hooks.config?.(config as never);
    assert.equal(config.agent?.planClaude?.model, "with-claude/opus");

    const createTask = (hooks.tool as PluginToolMap).create_task;
    const runClaudePlan = (hooks.tool as PluginToolMap).run_claude_plan;
    const getTaskContext = (hooks.tool as PluginToolMap).get_task_context;

    const created = await createTask!.execute!({
      title: "Global config task",
      request: "Use the global Claude config",
      requesterId: "plugin-user"
    });
    const taskId = created.match(/- taskId: (task-[a-z0-9-]+)/i)?.[1];
    assert.ok(taskId);

    await runClaudePlan!.execute!({ taskId, actorId: "planClaude" });
    const globalContext = await getTaskContext!.execute!({ taskId });
    assert.match(globalContext, /opus/);

    await writeWithClaudeConfig(
      path.join(projectRoot, ".opencode", "opencode-with-claude.jsonc"),
      withClaudeConfigJson({
        command: process.execPath,
        commonArgs: [claudeScript],
        planModel: "haiku",
        agentPlanModel: "with-claude/haiku"
      })
    );

    hooks = await plugin({
      directory: projectRoot,
      worktree: projectRoot,
      client: {} as never,
      project: {} as never,
      serverUrl: new URL("http://127.0.0.1"),
      $: {} as never
    });

    const overriddenConfig = {} as { agent?: Record<string, { model?: string }> };
    await hooks.config?.(overriddenConfig as never);
    assert.equal(overriddenConfig.agent?.planClaude?.model, "with-claude/haiku");

    const overrideCreateTask = (hooks.tool as PluginToolMap).create_task;
    const overrideRunClaudePlan = (hooks.tool as PluginToolMap).run_claude_plan;
    const overrideGetTaskContext = (hooks.tool as PluginToolMap).get_task_context;

    const overrideCreated = await overrideCreateTask!.execute!({
      title: "Project override task",
      request: "Use the project Claude config",
      requesterId: "plugin-user"
    });
    const overrideTaskId = overrideCreated.match(/- taskId: (task-[a-z0-9-]+)/i)?.[1];
    assert.ok(overrideTaskId);

    await overrideRunClaudePlan!.execute!({ taskId: overrideTaskId, actorId: "planClaude" });
    const overrideContext = await overrideGetTaskContext!.execute!({ taskId: overrideTaskId });
    assert.match(overrideContext, /haiku/);
  } finally {
    process.env = { ...originalEnv };
  }
});

test("plugin uses defaultModel for all roles and lets per-role model override it", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-defaultmodel-"));
  const xdgConfigHome = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-defaultmodel-xdg-"));
  const claudeScript = path.join(projectRoot, "fake-claude-defaultmodel.js");

  await writeFile(
    claudeScript,
    [
      "#!/usr/bin/env node",
      'const args = process.argv.slice(2);',
      'const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "missing-model";',
      'process.stdout.write(JSON.stringify({ planText: model }));'
    ].join("\n"),
    "utf8"
  );

  await writeWithClaudeConfig(
    path.join(projectRoot, ".opencode", "opencode-with-claude.jsonc"),
    withClaudeConfigJson({ command: process.execPath, commonArgs: [claudeScript], defaultModel: "opus" })
  );

  delete process.env.IMPLEMENTER_COMMAND;
  delete process.env.IMPLEMENTER_ARGS;
  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  process.env.DATA_DIR = "./data";

  try {
    let hooks = await plugin({
      directory: projectRoot,
      worktree: projectRoot,
      client: {} as never,
      project: {} as never,
      serverUrl: new URL("http://127.0.0.1"),
      $: {} as never
    });

    const createTask = (hooks.tool as PluginToolMap).create_task;
    const runClaudePlan = (hooks.tool as PluginToolMap).run_claude_plan;
    const getTaskContext = (hooks.tool as PluginToolMap).get_task_context;

    const created = await createTask!.execute!({
      title: "Default model task",
      request: "Use the shared default Claude model",
      requesterId: "plugin-user"
    });
    const taskId = created.match(/- taskId: (task-[a-z0-9-]+)/i)?.[1];
    assert.ok(taskId);

    await runClaudePlan!.execute!({ taskId, actorId: "planClaude" });
    const defaultContext = await getTaskContext!.execute!({ taskId });
    assert.match(defaultContext, /opus/);

    await writeWithClaudeConfig(
      path.join(projectRoot, ".opencode", "opencode-with-claude.jsonc"),
      withClaudeConfigJson({ command: process.execPath, commonArgs: [claudeScript], defaultModel: "sonnet", planModel: "haiku" })
    );

    hooks = await plugin({
      directory: projectRoot,
      worktree: projectRoot,
      client: {} as never,
      project: {} as never,
      serverUrl: new URL("http://127.0.0.1"),
      $: {} as never
    });

    const overrideCreateTask = (hooks.tool as PluginToolMap).create_task;
    const overrideRunClaudePlan = (hooks.tool as PluginToolMap).run_claude_plan;
    const overrideGetTaskContext = (hooks.tool as PluginToolMap).get_task_context;

    const overrideCreated = await overrideCreateTask!.execute!({
      title: "Per-role override task",
      request: "Use role-specific override over default model",
      requesterId: "plugin-user"
    });
    const overrideTaskId = overrideCreated.match(/- taskId: (task-[a-z0-9-]+)/i)?.[1];
    assert.ok(overrideTaskId);

    await overrideRunClaudePlan!.execute!({ taskId: overrideTaskId, actorId: "planClaude" });
    const overrideContext = await overrideGetTaskContext!.execute!({ taskId: overrideTaskId });
    assert.match(overrideContext, /haiku/);
  } finally {
    process.env = { ...originalEnv };
  }
});

test("plugin preserves global role args and agent prompt fields during partial project overrides", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-partial-"));
  const xdgConfigHome = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-partial-xdg-"));
  const claudeScript = path.join(projectRoot, "fake-claude-partial.js");

  await writeFile(
    claudeScript,
    [
      "#!/usr/bin/env node",
      'const args = process.argv.slice(2);',
      'const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "missing-model";',
      'const permission = args.includes("--permission-mode") ? args[args.indexOf("--permission-mode") + 1] : "missing-permission";',
      'process.stdout.write(JSON.stringify({ planText: `${model}:${permission}` }));'
    ].join("\n"),
    "utf8"
  );

  await writeWithClaudeConfig(
    path.join(xdgConfigHome, "opencode", ".opencode", "opencode-with-claude.jsonc"),
    JSON.stringify(
      {
        agent: {
          planClaude: {
            model: "with-claude/opus",
            prompt: "global-plan-prompt",
            tools: { run_claude_plan: true }
          }
        },
        claudeCli: {
          command: process.execPath,
          commonArgs: [claudeScript],
          roles: {
            planClaude: {
              model: "opus",
              args: ["--permission-mode", "plan"]
            },
            implClaude: {
              model: "sonnet",
              args: ["--permission-mode", "acceptEdits", "--add-dir", "{{workspaceRoot}}"]
            },
            reviewClaude: {
              model: "sonnet",
              args: ["--permission-mode", "plan"]
            }
          }
        }
      },
      null,
      2
    )
  );

  await writeWithClaudeConfig(
    path.join(projectRoot, ".opencode", "opencode-with-claude.jsonc"),
    JSON.stringify(
      {
        agent: {
          planClaude: {
            model: "with-claude/haiku"
          }
        },
        claudeCli: {
          roles: {
            planClaude: {
              model: "haiku"
            }
          }
        }
      },
      null,
      2
    )
  );

  process.env.XDG_CONFIG_HOME = xdgConfigHome;
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

    const config = {} as { agent?: Record<string, { model?: string; prompt?: string; tools?: Record<string, boolean> }> };
    await hooks.config?.(config as never);
    assert.equal(config.agent?.planClaude?.model, "with-claude/haiku");
    assert.equal(config.agent?.planClaude?.prompt, "global-plan-prompt");
    assert.equal(config.agent?.planClaude?.tools?.run_claude_plan, true);

    const createTask = (hooks.tool as PluginToolMap).create_task;
    const runClaudePlan = (hooks.tool as PluginToolMap).run_claude_plan;
    const getTaskContext = (hooks.tool as PluginToolMap).get_task_context;

    const created = await createTask!.execute!({
      title: "Partial override task",
      request: "Keep global args while overriding model",
      requesterId: "plugin-user"
    });
    const taskId = created.match(/- taskId: (task-[a-z0-9-]+)/i)?.[1];
    assert.ok(taskId);

    await runClaudePlan!.execute!({ taskId, actorId: "planClaude" });
    const context = await getTaskContext!.execute!({ taskId });
    assert.match(context, /haiku:plan/);
  } finally {
    process.env = { ...originalEnv };
  }
});

test("session startup syncs bundled prompts and migrates legacy managed config into an override file", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-sync-"));
  const xdgConfigHome = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-sync-xdg-"));
  const configRoot = path.join(xdgConfigHome, "opencode");
  const legacyConfigPath = path.join(configRoot, ".opencode", "opencode-with-claude.jsonc");
  const staleAgentPath = path.join(configRoot, ".opencode", "agents", "planClaude.md");
  const staleCommandPath = path.join(configRoot, ".opencode", "command", "planClaude.md");
  const pluginPackageJsonPath = path.join(configRoot, "package.json");
  const pluginShimPath = path.join(configRoot, "plugins", "with-claude-plugin.mjs");

  const bundledConfig = await readFile(path.join(process.cwd(), ".opencode", "opencode-with-claude.jsonc"), "utf8");
  await writeWithClaudeConfig(legacyConfigPath, bundledConfig);
  await writeWithClaudeConfig(staleAgentPath, "stale-agent\n");
  await writeWithClaudeConfig(staleCommandPath, "stale-command\n");

  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  process.env.DATA_DIR = "./data";

  const toastCalls: string[] = [];
  try {
    const hooks = await plugin({
      directory: projectRoot,
      worktree: projectRoot,
      client: {
        tui: {
          showToast: async (input: { body: { title: string } }) => {
            toastCalls.push(input.body.title);
          }
        }
      } as never,
      project: {} as never,
      serverUrl: new URL("http://127.0.0.1"),
      $: {} as never
    });

    assert.equal(typeof hooks.event, "function");
    await hooks.event?.({ event: { type: "session.created", properties: { info: {} } } } as never);
    await waitFor(async () => {
      const syncedAgent = await readFile(staleAgentPath, "utf8");
      const syncedCommand = await readFile(staleCommandPath, "utf8");
      const bundledAgent = await readFile(path.join(process.cwd(), ".opencode", "agents", "planClaude.md"), "utf8");
      const bundledCommand = await readFile(path.join(process.cwd(), ".opencode", "command", "planClaude.md"), "utf8");
      assert.equal(syncedAgent, bundledAgent);
      assert.equal(syncedCommand, bundledCommand);
    });

    const migratedConfig = await readFile(legacyConfigPath, "utf8");
    const syncedAgent = await readFile(staleAgentPath, "utf8");
    const syncedCommand = await readFile(staleCommandPath, "utf8");
    const pluginPackageJson = await readFile(pluginPackageJsonPath, "utf8");
    const pluginShim = await readFile(pluginShimPath, "utf8");
    const bundledAgent = await readFile(path.join(process.cwd(), ".opencode", "agents", "planClaude.md"), "utf8");
    const bundledCommand = await readFile(path.join(process.cwd(), ".opencode", "command", "planClaude.md"), "utf8");

    assert.match(migratedConfig, /Optional user overrides only/);
    assert.equal(syncedAgent, bundledAgent);
    assert.equal(syncedCommand, bundledCommand);
    assert.match(pluginPackageJson, /"@little_tale\/opencode-with-claude": "latest"/);
    assert.match(pluginShim, /@little_tale\/opencode-with-claude\/plugin/);
    assert.deepEqual(toastCalls, ["WithClaude Updated"]);
  } finally {
    process.env = { ...originalEnv };
  }
});

test("session startup preserves customized legacy config while migrating the exact legacy managed default", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-sync-legacy-"));
  const xdgConfigHome = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-sync-legacy-xdg-"));
  const configRoot = path.join(xdgConfigHome, "opencode");
  const managedConfigPath = path.join(configRoot, ".opencode", "opencode-with-claude.jsonc");
  const customConfigPath = path.join(projectRoot, ".opencode", "opencode-with-claude.jsonc");

  await writeWithClaudeConfig(
    managedConfigPath,
    JSON.stringify(
      {
        claudeCli: {
          command: "claude",
          commonArgs: ["-p", "--output-format", "json"],
          timeoutMs: 900000,
          roles: {
            planClaude: { model: "sonnet", args: ["--permission-mode", "plan"] },
            implClaude: { model: "sonnet", args: ["--permission-mode", "acceptEdits", "--add-dir", "{{workspaceRoot}}"] },
            reviewClaude: { model: "sonnet", args: ["--permission-mode", "plan"] }
          }
        }
      },
      null,
      2
    )
  );

  await writeWithClaudeConfig(
    customConfigPath,
    JSON.stringify(
      {
        claudeCli: {
          command: "claude",
          commonArgs: ["-p", "--output-format", "json"],
          timeoutMs: 900000,
          roles: {
            planClaude: { model: "opus", args: ["--permission-mode", "plan"] },
            implClaude: { model: "sonnet", args: ["--permission-mode", "acceptEdits", "--add-dir", "{{workspaceRoot}}"] },
            reviewClaude: { model: "sonnet", args: ["--permission-mode", "plan"] }
          }
        }
      },
      null,
      2
    )
  );

  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  process.env.DATA_DIR = "./data";

  try {
    const hooks = await plugin({
      directory: projectRoot,
      worktree: projectRoot,
      client: { tui: { showToast: async () => {} } } as never,
      project: {} as never,
      serverUrl: new URL("http://127.0.0.1"),
      $: {} as never
    });

    await hooks.event?.({ event: { type: "session.created", properties: { info: {} } } } as never);

    const migratedManagedConfig = await readFile(managedConfigPath, "utf8");
    const preservedCustomConfig = await readFile(customConfigPath, "utf8");

    assert.match(migratedManagedConfig, /defaultModel/);
    assert.match(migratedManagedConfig, /Optional user overrides only/);
    assert.match(preservedCustomConfig, /"model": "opus"/);
    assert.doesNotMatch(preservedCustomConfig, /Optional user overrides only/);
  } finally {
    process.env = { ...originalEnv };
  }
});

test("session startup skips auto-update when shell runner is unavailable", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-noshell-"));
  const xdgConfigHome = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-noshell-xdg-"));
  const configRoot = path.join(xdgConfigHome, "opencode");

  await writeWithClaudeConfig(path.join(configRoot, "package.json"), JSON.stringify({ dependencies: { "@little_tale/opencode-with-claude": "latest" } }, null, 2));
  await writeWithClaudeConfig(path.join(configRoot, "node_modules", "@little_tale", "opencode-with-claude", "package.json"), JSON.stringify({ version: "0.1.1" }, null, 2));

  const originalFetch = globalThis.fetch;
  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  process.env.DATA_DIR = "./data";
  let fetchCalls = 0;
  const toastCalls: string[] = [];

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ version: "0.1.2" }), { status: 200 });
  }) as typeof fetch;

  try {
    const hooks = await plugin({
      directory: projectRoot,
      worktree: projectRoot,
      client: {
        tui: {
          showToast: async (input: { body: { title: string } }) => {
            toastCalls.push(input.body.title);
          }
        }
      } as never,
      project: {} as never,
      serverUrl: new URL("http://127.0.0.1"),
      $: {} as never
    });

    await hooks.event?.({ event: { type: "session.created", properties: { info: {} } } } as never);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(toastCalls, ["WithClaude Updated"]);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  }
});

test("session startup auto-updates the plugin package when a newer latest version exists", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-update-"));
  const xdgConfigHome = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-update-xdg-"));
  const configRoot = path.join(xdgConfigHome, "opencode");

  await writeWithClaudeConfig(path.join(configRoot, "package.json"), JSON.stringify({ dependencies: { "@little_tale/opencode-with-claude": "latest" } }, null, 2));
  await writeWithClaudeConfig(path.join(configRoot, "node_modules", "@little_tale", "opencode-with-claude", "package.json"), JSON.stringify({ version: "0.1.1" }, null, 2));

  const originalFetch = globalThis.fetch;
  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  process.env.DATA_DIR = "./data";
  const toastCalls: string[] = [];
  const shellCalls: string[] = [];

  globalThis.fetch = (async () => new Response(JSON.stringify({ version: "0.1.2" }), { status: 200 })) as typeof fetch;

  try {
    const shell = Object.assign(
      ((strings: TemplateStringsArray, ...expressions: Array<{ toString(): string } | string>) => {
        shellCalls.push(String.raw(strings, ...expressions));
        return {
          exitCode: 0,
          stdout: Buffer.from(""),
          stderr: Buffer.from(""),
          text: () => "",
          json: () => ({}),
          arrayBuffer: () => new ArrayBuffer(0),
          bytes: () => new Uint8Array(),
          blob: () => new Blob(),
          cwd: () => this,
          env: () => this,
          quiet: () => this,
          lines: async function* () {},
          nothrow: () => this,
          throws: () => this,
          then: undefined
        } as never;
      }) as never,
      {
        cwd() {
          return this;
        },
        env() {
          return this;
        },
        nothrow() {
          return this;
        },
        throws() {
          return this;
        },
        braces() {
          return [];
        },
        escape(input: string) {
          return input;
        }
      }
    );

    const hooks = await plugin({
      directory: projectRoot,
      worktree: projectRoot,
      client: {
        tui: {
          showToast: async (input: { body: { title: string } }) => {
            toastCalls.push(input.body.title);
          }
        }
      } as never,
      project: {} as never,
      serverUrl: new URL("http://127.0.0.1"),
      $: shell
    });

    await hooks.event?.({ event: { type: "session.created", properties: { info: {} } } } as never);
    await waitFor(() => {
      assert.ok(shellCalls.some((call) => call.includes("@little_tale/opencode-with-claude@latest")));
      assert.ok(toastCalls.includes("WithClaude Auto-updated"));
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  }
});

test("session startup warns when automatic update fails", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-update-fail-"));
  const xdgConfigHome = await mkdtemp(path.join(os.tmpdir(), "agentwf-plugin-update-fail-xdg-"));
  const configRoot = path.join(xdgConfigHome, "opencode");

  await writeWithClaudeConfig(path.join(configRoot, "package.json"), JSON.stringify({ dependencies: { "@little_tale/opencode-with-claude": "latest" } }, null, 2));
  await writeWithClaudeConfig(path.join(configRoot, "node_modules", "@little_tale", "opencode-with-claude", "package.json"), JSON.stringify({ version: "0.1.1" }, null, 2));

  const originalFetch = globalThis.fetch;
  process.env.XDG_CONFIG_HOME = xdgConfigHome;
  process.env.DATA_DIR = "./data";
  const toastCalls: string[] = [];

  globalThis.fetch = (async () => new Response(JSON.stringify({ version: "0.1.2" }), { status: 200 })) as typeof fetch;

  try {
    const shell = Object.assign(
      ((strings: TemplateStringsArray, ...expressions: Array<{ toString(): string } | string>) => {
        void String.raw(strings, ...expressions);
        return Promise.resolve({
          exitCode: 1,
          stdout: Buffer.from(""),
          stderr: Buffer.from("failed"),
          text: () => "",
          json: () => ({}),
          arrayBuffer: () => new ArrayBuffer(0),
          bytes: () => new Uint8Array(),
          blob: () => new Blob()
        });
      }) as never,
      {
        cwd() {
          return this;
        },
        env() {
          return this;
        },
        nothrow() {
          return this;
        },
        throws() {
          return this;
        },
        braces() {
          return [];
        },
        escape(input: string) {
          return input;
        }
      }
    );

    const hooks = await plugin({
      directory: projectRoot,
      worktree: projectRoot,
      client: {
        tui: {
          showToast: async (input: { body: { title: string } }) => {
            toastCalls.push(input.body.title);
          }
        }
      } as never,
      project: {} as never,
      serverUrl: new URL("http://127.0.0.1"),
      $: shell
    });

    await hooks.event?.({ event: { type: "session.created", properties: { info: {} } } } as never);
    await waitFor(() => {
      assert.ok(toastCalls.includes("WithClaude Update Available"));
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  }
});
